import { describe, expect, test } from 'bun:test'
import {
  type GhdConfig,
  mergeConfig,
  type RepoConfig,
  selectReposForUpdate,
  updateRepos,
} from './config'

function repo(overrides: Partial<RepoConfig> = {}): RepoConfig {
  return {
    repoDirectory: 'owner/repo/path',
    commit: 'abc123',
    include: [],
    exclude: [],
    outputDirectory: 'out',
    ...overrides,
  }
}

describe('mergeConfig', () => {
  test('appends remote repos not present in the local config', () => {
    const local: GhdConfig = { repos: [repo({ repoDirectory: 'a/a' })] }
    const remote: GhdConfig = { repos: [repo({ repoDirectory: 'b/b' })] }

    const merged = mergeConfig(local, remote)

    expect(merged.repos.map((r) => r.repoDirectory)).toEqual(['a/a', 'b/b'])
  })

  test('remote entry wins on repoDirectory conflict, keeping local position', () => {
    const local: GhdConfig = {
      repos: [
        repo({ repoDirectory: 'a/a', commit: 'local' }),
        repo({ repoDirectory: 'b/b', commit: 'local' }),
      ],
    }
    const remote: GhdConfig = {
      repos: [repo({ repoDirectory: 'a/a', commit: 'remote' })],
    }

    const merged = mergeConfig(local, remote)

    expect(merged.repos.map((r) => [r.repoDirectory, r.commit])).toEqual([
      ['a/a', 'remote'],
      ['b/b', 'local'],
    ])
  })

  test('does not mutate the input configs', () => {
    const local: GhdConfig = { repos: [repo({ repoDirectory: 'a/a' })] }
    const remote: GhdConfig = { repos: [repo({ repoDirectory: 'b/b' })] }

    mergeConfig(local, remote)

    expect(local.repos.map((r) => r.repoDirectory)).toEqual(['a/a'])
    expect(remote.repos.map((r) => r.repoDirectory)).toEqual(['b/b'])
  })
})
describe('selectReposForUpdate', () => {
  test('returns all repos when no targets are given', () => {
    const config: GhdConfig = {
      repos: [repo({ repoDirectory: 'a/a' }), repo({ repoDirectory: 'b/b' })],
    }

    const result = selectReposForUpdate(config, [])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.repos.map((r) => r.repoDirectory)).toEqual(['a/a', 'b/b'])
    }
  })

  test('returns matched repos in target order', () => {
    const config: GhdConfig = {
      repos: [repo({ repoDirectory: 'a/a' }), repo({ repoDirectory: 'b/b' })],
    }

    const result = selectReposForUpdate(config, ['b/b', 'a/a'])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.repos.map((r) => r.repoDirectory)).toEqual(['b/b', 'a/a'])
    }
  })

  test('returns references to the config repos so mutations persist', () => {
    const config: GhdConfig = { repos: [repo({ repoDirectory: 'a/a' })] }

    const result = selectReposForUpdate(config, ['a/a'])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.repos[0]).toBe(config.repos[0])
    }
  })

  test('reports missing targets and matches exactly on repoDirectory', () => {
    const config: GhdConfig = { repos: [repo({ repoDirectory: 'a/a' })] }

    const result = selectReposForUpdate(config, ['a/a', 'a', 'c/c'])

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.missing).toEqual(['a', 'c/c'])
    }
  })
})
describe('updateRepos', () => {
  function baseConfig(): GhdConfig {
    return {
      repos: [
        repo({
          repoDirectory: 'a/a',
          commit: 'old-a',
          outputDirectory: 'outA',
        }),
        repo({
          repoDirectory: 'b/b',
          commit: 'old-b',
          outputDirectory: 'outB',
        }),
      ],
    }
  }

  test('re-pins each repo to the downloaded commit and reports updated repos', async () => {
    const config = baseConfig()
    const downloaded: string[] = []
    const gitignored: string[] = []
    const saved: Array<[GhdConfig, string]> = []

    const result = await updateRepos(config, 'cfg.yaml', [], {
      download: async (repoPath) => {
        downloaded.push(repoPath)
        return { commit: `new-${repoPath}` }
      },
      updateGitignore: async (target) => {
        gitignored.push(target)
      },
      saveConfig: async (c, p) => {
        saved.push([c, p])
      },
    })

    expect(result).toEqual({ ok: true, updated: config.repos })
    expect(config.repos.map((r) => r.commit)).toEqual(['new-a/a', 'new-b/b'])
    expect(downloaded).toEqual(['a/a', 'b/b'])
    expect(gitignored).toEqual(['outA', 'outB'])
    expect(saved).toEqual([[config, 'cfg.yaml']])
  })

  test('persists completed re-pins even when a later download throws', async () => {
    const config = baseConfig()
    let saveCount = 0

    const promise = updateRepos(config, 'cfg.yaml', [], {
      download: async (repoPath) => {
        if (repoPath === 'b/b') throw new Error('boom')
        return { commit: `new-${repoPath}` }
      },
      updateGitignore: async () => {},
      saveConfig: async () => {
        saveCount++
      },
    })

    await expect(promise).rejects.toThrow('boom')
    expect(config.repos[0]!.commit).toBe('new-a/a')
    expect(config.repos[1]!.commit).toBe('old-b')
    expect(saveCount).toBe(1)
  })

  test('returns missing targets without downloading or saving', async () => {
    const config = baseConfig()
    let downloadCount = 0
    let saveCount = 0

    const result = await updateRepos(config, 'cfg.yaml', ['a/a', 'c/c'], {
      download: async () => {
        downloadCount++
        return { commit: 'x' }
      },
      updateGitignore: async () => {},
      saveConfig: async () => {
        saveCount++
      },
    })

    expect(result).toEqual({ ok: false, missing: ['c/c'] })
    expect(downloadCount).toBe(0)
    expect(saveCount).toBe(0)
  })

  test('does not save when there are no repos to update', async () => {
    const config: GhdConfig = { repos: [] }
    let saveCount = 0

    const result = await updateRepos(config, 'cfg.yaml', [], {
      download: async () => ({ commit: 'x' }),
      updateGitignore: async () => {},
      saveConfig: async () => {
        saveCount++
      },
    })

    expect(result).toEqual({ ok: true, updated: [] })
    expect(saveCount).toBe(0)
  })
})