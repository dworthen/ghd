import { $ } from 'bun'

const AUTH_STATUS_COMMAND = [
  'gh',
  'auth',
  'status',
  '-t',
  '--json',
  'hosts',
] as const

interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

interface GithubAuthEntry {
  token?: unknown
}

interface GithubAuthStatus {
  hosts?: {
    'github.com'?: unknown
  }
}

export interface GithubTokenDependencies {
  runCommand?: (command: readonly string[]) => Promise<CommandResult>
  fetch?: typeof globalThis.fetch
}

async function runCommand(command: readonly string[]): Promise<CommandResult> {
  const result = await $`${command}`.nothrow().quiet()
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

function getTokens(stdout: string): string[] {
  let status: GithubAuthStatus
  try {
    status = JSON.parse(stdout) as GithubAuthStatus
  } catch {
    throw new Error('GitHub CLI returned invalid authentication status JSON')
  }

  const entries = status.hosts?.['github.com']
  if (!Array.isArray(entries)) return []

  return entries.flatMap((entry: GithubAuthEntry) =>
    typeof entry?.token === 'string' && entry.token.length > 0
      ? [entry.token]
      : [],
  )
}

/** Find the first GitHub CLI token that can access an OWNER/REPO slug. */
export async function getGithubToken(
  slug: string,
  dependencies: GithubTokenDependencies = {},
): Promise<string> {
  const [owner, repo, ...extra] = slug.split('/')
  if (!owner || !repo || extra.length > 0) {
    throw new Error(`Invalid GitHub repository slug: ${slug}`)
  }

  const execute = dependencies.runCommand ?? runCommand
  const request = dependencies.fetch ?? globalThis.fetch

  let result: CommandResult
  try {
    result = await execute(AUTH_STATUS_COMMAND)
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : ''
    throw new Error(`Failed to get tokens from GitHub CLI${detail}`)
  }

  if (result.exitCode !== 0) {
    const detail = result.stderr.trim()
    throw new Error(
      `Failed to get tokens from GitHub CLI${detail ? `: ${detail}` : ''}`,
    )
  }

  const tokens = getTokens(result.stdout)
  if (tokens.length === 0) {
    throw new Error('No GitHub CLI tokens found for github.com')
  }

  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  for (const token of tokens) {
    try {
      const response = await request(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2026-03-10',
        },
      })
      if (response.ok) return token
    } catch {
      // A network failure only rejects this candidate; another token may work.
    }
  }

  throw new Error(`No GitHub CLI token can access ${slug}`)
}