import { describe, expect, test } from 'bun:test'
import { type GithubTokenDependencies, getGithubToken } from './github-token'

const authStatus = (githubEntries: unknown[], otherEntries: unknown[] = []) =>
  JSON.stringify({
    hosts: {
      'github.com': githubEntries,
      'github.example.com': otherEntries,
    },
  })

function dependencies(stdout: string, responses: Array<Response | Error> = []) {
  const commands: Array<readonly string[]> = []
  const requests: Array<{ url: string; init?: RequestInit }> = []
  let responseIndex = 0

  const deps: GithubTokenDependencies = {
    runCommand: async (command) => {
      commands.push(command)
      return { exitCode: 0, stdout, stderr: '' }
    },
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init })
      const response = responses[responseIndex++]
      if (response instanceof Error) throw response
      if (!response) throw new Error('Unexpected fetch')
      return response
    }) as typeof fetch,
  }

  return { commands, deps, requests }
}

describe('getGithubToken', () => {
  test('runs gh auth status and returns the first token that can access the repository', async () => {
    const { commands, deps, requests } = dependencies(
      authStatus(
        [
          { token: 'first-token' },
          { token: 'second-token' },
          { token: 'unused-token' },
        ],
        [{ token: 'enterprise-token' }],
      ),
      [
        new Response(null, { status: 404 }),
        new Response(null, { status: 200 }),
      ],
    )

    await expect(getGithubToken('octo-org/octo-repo', deps)).resolves.toBe(
      'second-token',
    )

    expect(commands).toEqual([
      ['gh', 'auth', 'status', '-t', '--json', 'hosts'],
    ])
    expect(requests).toHaveLength(2)
    expect(requests[0]?.url).toBe(
      'https://api.github.com/repos/octo-org/octo-repo',
    )
    expect(requests[0]?.init?.headers).toEqual({
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer first-token',
      'X-GitHub-Api-Version': '2026-03-10',
    })
    expect(requests[1]?.init?.headers).toMatchObject({
      Authorization: 'Bearer second-token',
      'X-GitHub-Api-Version': '2026-03-10',
    })
  })

  test('continues after a request error and stops after the first success', async () => {
    const { deps, requests } = dependencies(
      authStatus([
        { token: 'network-error' },
        { token: 'working-token' },
        { token: 'not-tested' },
      ]),
      [
        new TypeError('network unavailable'),
        new Response(null, { status: 204 }),
      ],
    )

    await expect(getGithubToken('owner/repo', deps)).resolves.toBe(
      'working-token',
    )
    expect(requests).toHaveLength(2)
  })

  test('throws when gh auth status fails', async () => {
    const deps: GithubTokenDependencies = {
      runCommand: async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'not logged in',
      }),
    }

    await expect(getGithubToken('owner/repo', deps)).rejects.toThrow(
      'Failed to get tokens from GitHub CLI: not logged in',
    )
  })

  test('throws for invalid auth status JSON', async () => {
    const { deps } = dependencies('not json')

    await expect(getGithubToken('owner/repo', deps)).rejects.toThrow(
      'GitHub CLI returned invalid authentication status JSON',
    )
  })

  test('throws when github.com has no tokens', async () => {
    const { deps } = dependencies(
      JSON.stringify({
        hosts: { 'github.example.com': [{ token: 'enterprise-token' }] },
      }),
    )

    await expect(getGithubToken('owner/repo', deps)).rejects.toThrow(
      'No GitHub CLI tokens found for github.com',
    )
  })

  test('throws after all github.com tokens are rejected', async () => {
    const { deps, requests } = dependencies(
      authStatus([{ token: 'forbidden' }, { token: 'missing' }]),
      [
        new Response(null, { status: 403 }),
        new Response(null, { status: 404 }),
      ],
    )

    await expect(getGithubToken('owner/repo', deps)).rejects.toThrow(
      'No GitHub CLI token can access owner/repo',
    )
    expect(requests).toHaveLength(2)
  })

  test('rejects a slug that is not OWNER/REPO before running gh', async () => {
    let commandRan = false
    const deps: GithubTokenDependencies = {
      runCommand: async () => {
        commandRan = true
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    }

    await expect(getGithubToken('owner', deps)).rejects.toThrow(
      'Invalid GitHub repository slug: owner',
    )
    expect(commandRan).toBeFalse()
  })
})