import { relative } from 'node:path'
import { $, Glob } from 'bun'
import { getFiles } from './directory'
import { getValue } from './records'
import { resolvePath } from './resolvePath'

export type RepoInfo = {
  owner: string
  repo: string
  path: string
  commit: string
  branch: string
  token: string
}

export type GithubFileContentsResponse = {
  content: string
  sha: string
}

export class CommandNotFound extends Error {
  constructor(cmd: string) {
    super(
      `Command not found: '${cmd}'. Please install it and ensure it is available on path.`,
    )
    this.name = 'CommandNotFound'
  }
}

export class GhAuthStatusFailure extends Error {
  constructor(message: string) {
    super(
      `Failed to run \`gh auth status\` command to get GitHub authentication tokens: ${message}`,
    )
    this.name = 'GhAuthStatusFailure'
  }
}

export class GithubTokensNotFound extends Error {
  constructor() {
    super(
      'Github tokens not found. Please run `gh auth login` to authenticate with GitHub.',
    )
    this.name = 'GithubTokensNotFound'
  }
}

export class GhAuthorizationError extends Error {
  constructor(repoPath: string) {
    super(
      `Failed to obtain GitHub token for '${repoPath}'. Be sure to run \`gh auth login\` to authenticate with GitHub using the correct account or that the repo exists.`,
    )
    this.name = 'GhAuthorizationError'
  }
}

export class NetworkRequestFailure extends Error {
  constructor(response: Response) {
    super(
      `Failed to make request to ${response.url}: ${response.status} - ${response.statusText}`,
    )
    this.name = 'NetworkRequestFailure'
  }
}

export class UnexpectedJsonResponse extends Error {
  constructor(response: Response, path: string, json: string) {
    super(
      `Unexpected JSON response from ${response.url}. Expected value at path '${path}' but got:\n\n ${json}`,
    )
    this.name = 'UnexpectedJsonResponse'
  }
}

export class InvalidGithubCommitSha extends Error {
  constructor(repoPath: string, commitSha: string) {
    super(
      `Invalid commit SHA '${commitSha}' for repository '${repoPath}'. Tags and branches are not allowed.`,
    )
    this.name = 'InvalidGithubCommitSha'
  }
}

export class InvalidGithubRepoSlug extends Error {
  constructor(repoPath: string) {
    super(
      `Invalid GitHub repository slug: '${repoPath}'. A valid slug should be in the format 'owner/repo[/additional/path][@commitSha]'.`,
    )
    this.name = 'InvalidGithubRepoSlug'
  }
}

async function checkForGhCommand(): Promise<void> {
  const result = await $`gh --version`.nothrow().quiet()
  if (result.exitCode !== 0) {
    throw new CommandNotFound('gh')
  }
}

async function getGhTokens(): Promise<string[]> {
  await checkForGhCommand()
  const result = await $`gh auth status --json hosts -t`.nothrow().quiet()
  if (result.exitCode !== 0) {
    throw new GhAuthStatusFailure(result.stderr.toString())
  }
  const stdout = result.stdout.toString()
  let status: unknown
  try {
    status = JSON.parse(stdout)
  } catch (error) {
    throw new GhAuthStatusFailure(
      `Failed to parse JSON output from \`gh auth status\` command: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const hosts = getValue(status, 'hosts')

  if (!hosts || typeof hosts !== 'object') {
    throw new GithubTokensNotFound()
  }

  const ghHost = hosts['github.com']

  if (!ghHost || !Array.isArray(ghHost)) {
    throw new GithubTokensNotFound()
  }
  const tokens = ghHost
    .map((e) => e.token)
    .filter((t) => typeof t === 'string' && t.length > 0) as string[]
  if (tokens.length === 0) {
    throw new GithubTokensNotFound()
  }
  return tokens
}

export async function getGithubToken(
  owner: string,
  repo: string,
): Promise<string> {
  const tokens = await getGhTokens()
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  for (const token of tokens) {
    try {
      const response = await fetch(url, {
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
  throw new GhAuthorizationError(`${owner}/${repo}`)
}

export async function getDefaultBranch(
  owner: string,
  repo: string,
  token: string,
): Promise<string> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2026-03-10',
    },
  })
  if (!response.ok) {
    throw new NetworkRequestFailure(response)
  }
  const data = (await response.json()) as any
  const branch = getValue(data, 'default_branch')
  if (!branch || typeof branch !== 'string' || branch.trim() === '') {
    throw new UnexpectedJsonResponse(
      response,
      'default_branch',
      JSON.stringify(data, null, 2),
    )
  }
  return branch
}

export async function getLatestCommit(
  owner: string,
  repo: string,
  token: string,
): Promise<string> {
  const branch = await getDefaultBranch(owner, repo, token)

  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(branch)}`
  const commitResponse = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2026-03-10',
    },
  })
  if (!commitResponse.ok) {
    throw new NetworkRequestFailure(commitResponse)
  }

  const commit: unknown = await commitResponse.json()
  const commitSha = getValue(commit, 'sha')
  if (!commitSha || typeof commitSha !== 'string' || commitSha.trim() === '') {
    throw new UnexpectedJsonResponse(
      commitResponse,
      'sha',
      JSON.stringify(commit, null, 2),
    )
  }
  return commitSha
}

export async function verifyCommit(
  owner: string,
  repo: string,
  commitSha: string,
  token: string,
): Promise<string> {
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  for (const kind of ['heads', 'tags']) {
    const url = `${base}/git/ref/${kind}/${encodeURIComponent(commitSha)}`
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2026-03-10',
      },
    })
    if (response.ok) {
      throw new InvalidGithubCommitSha(`${owner}/${repo}`, commitSha)
    }
  }

  const url = `${base}/commits/${encodeURIComponent(commitSha)}`
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2026-03-10',
    },
  })
  if (!response.ok) {
    throw new NetworkRequestFailure(response)
  }

  const value: unknown = await response.json()
  const sha = getValue(value, 'sha')
  if (!sha || typeof sha !== 'string' || sha.trim() === '') {
    throw new UnexpectedJsonResponse(
      response,
      'sha',
      JSON.stringify(value, null, 2),
    )
  }
  if (!sha.toLowerCase().startsWith(commitSha.toLowerCase())) {
    throw new InvalidGithubCommitSha(`${owner}/${repo}`, commitSha)
  }
  return sha
}

export async function parseRepoPath(repoPath: string): Promise<RepoInfo> {
  const [repoComponents, commitSha] = repoPath.split('@')

  if (!repoComponents) {
    throw new InvalidGithubRepoSlug(repoPath)
  }

  const [owner, repo, ...rest] = repoComponents.split('/')
  if (!owner || !repo) {
    throw new InvalidGithubRepoSlug(repoPath)
  }

  const token = await getGithubToken(owner, repo)

  if (commitSha) {
    await verifyCommit(owner, repo, commitSha, token)
  }

  return {
    owner,
    repo,
    path: rest.join('/'),
    commit: commitSha ?? (await getLatestCommit(owner, repo, token)),
    branch: await getDefaultBranch(owner, repo, token),
    token,
  }
}

export async function getFileContents(
  owner: string,
  repo: string,
  path: string,
  token: string,
): Promise<GithubFileContentsResponse> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2026-03-10',
    },
  })
  if (!response.ok) {
    throw new NetworkRequestFailure(response)
  }
  const data = await response.json()
  const content = getValue(data, 'content')
  const sha = getValue(data, 'sha')
  if (typeof content !== 'string') {
    throw new UnexpectedJsonResponse(
      response,
      'content',
      JSON.stringify(data, null, 2),
    )
  }
  if (!sha || typeof sha !== 'string' || sha.trim() === '') {
    throw new UnexpectedJsonResponse(
      response,
      'sha',
      JSON.stringify(data, null, 2),
    )
  }

  return data as GithubFileContentsResponse
}

export async function getExistingSha(
  owner: string,
  repo: string,
  path: string,
  token: string,
): Promise<string | null> {
  try {
    const data = await getFileContents(owner, repo, path, token)
    return data.sha ?? null
  } catch (_) {
    return null
  }
}

export async function getTree(
  owner: string,
  repo: string,
  branch: string,
  subTree: string,
  include: string[],
  exclude: string[],
  token: string,
): Promise<[string, string][]> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2026-03-10',
    },
  })
  if (!response.ok) {
    throw new NetworkRequestFailure(response)
  }
  const includeGlobs = include.map(
    (pattern) => new Glob(subTree ? `${subTree}/${pattern}` : pattern),
  )
  const excludeGlobs = exclude.map(
    (pattern) => new Glob(subTree ? `${subTree}/${pattern}` : pattern),
  )
  return ((await response.json()) as any).tree
    .filter((t: any) => {
      const isBlob = t.type === 'blob'
      const path = t.path as string
      const inSubTree = subTree ? path.startsWith(`${subTree}/`) : true
      const included =
        includeGlobs.length === 0 ||
        includeGlobs.some((glob) => glob.match(path))
      const excluded = excludeGlobs.some((glob) => glob.match(path))
      return isBlob && inSubTree && included && !excluded
    })
    .map((item: any) => {
      const path = item.path as string
      return [path, path.slice(subTree.length ? subTree.length + 1 : 0)] as [
        string,
        string,
      ]
    }) as [string, string][]
}

export async function downloadFile(
  owner: string,
  repo: string,
  repoPath: string,
  to: string,
  token: string,
): Promise<void> {
  to = resolvePath(to)
  const data = await getFileContents(owner, repo, repoPath, token)
  const file = Bun.file(to)
  const contents = data.content
    ? Buffer.from(data.content.replace(/\s+/g, ''), 'base64')
    : ''
  await Bun.write(file, contents)
}

export async function downloadFiles(
  repoPath: string,
  include: string[],
  exclude: string[],
  targetDirectory: string,
): Promise<void> {
  targetDirectory = resolvePath(targetDirectory)

  const {
    owner,
    repo,
    branch,
    path: subTree,
    token,
  } = await parseRepoPath(repoPath)

  const files = await getTree(
    owner,
    repo,
    branch,
    subTree,
    include,
    exclude,
    token,
  )
  console.log(`Downloading ${files.length} file(s) from ${repoPath}...`)
  await Promise.all(
    files.map(async ([from, to]) => {
      const targetPath = resolvePath(targetDirectory, to)
      await downloadFile(owner, repo, from, targetPath, token)
      console.log(`Downloaded: ${to} -> ${relative(process.cwd(), targetPath)}`)
    }),
  )
}

export async function uploadFile(
  owner: string,
  repo: string,
  from: string,
  repoPath: string,
  token: string,
): Promise<void> {
  from = resolvePath(from)

  const file = Bun.file(from)
  if (!(await file.exists())) {
    throw new Error(`File not found: ${from}`)
  }

  const base64FileContents = (await file.bytes()).toBase64({
    alphabet: 'base64',
  })

  const sha = await getExistingSha(owner, repo, repoPath, token)
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${repoPath}`
  const body = {
    message: `Upload ${repoPath}`,
    content: base64FileContents,
    ...(sha ? { sha } : {}),
  }
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2026-03-10',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new NetworkRequestFailure(response)
  }
}

export async function uploadFiles(
  sourceDirectory: string,
  repoPath: string,
  includes: string[],
  excludes: string[],
): Promise<void> {
  sourceDirectory = resolvePath(sourceDirectory)

  const { owner, repo, path, token } = await parseRepoPath(repoPath)
  const localFiles = await getFiles(sourceDirectory, includes, excludes)
  console.log(`Uploading ${localFiles.length} files to ${repoPath}`)
  for (const [fullPath, relativePath] of localFiles) {
    const repoPath = [path, relativePath].join('/')
    await uploadFile(owner, repo, fullPath, repoPath, token)
    console.log(`Uploaded ${relativePath} to ${repoPath}`)
  }
}

export async function deleteFile(
  owner: string,
  repo: string,
  path: string,
  token: string,
): Promise<void> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`
  const sha = await getExistingSha(owner, repo, path, token)
  if (!sha) {
    return
  }
  const body = {
    message: `Delete ${path}`,
    sha,
  }
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2026-03-10',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new NetworkRequestFailure(response)
  }
}

export async function deleteFiles(
  repoPath: string,
  include: string[],
  exclude: string[],
): Promise<void> {
  const { owner, repo, path, branch, token } = await parseRepoPath(repoPath)

  const files = await getTree(
    owner,
    repo,
    branch,
    path,
    include,
    exclude,
    token,
  )
  console.log(`Deleting ${files.length} file(s) from ${repoPath}...`)
  for (const [from] of files) {
    await deleteFile(owner, repo, from, token)
    console.log(`Deleted ${from} from ${repoPath}`)
  }
}