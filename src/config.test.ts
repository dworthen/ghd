import { describe, expect, test } from 'bun:test'
import {
  type GhdConfig,
  mergeConfig,
  type RepoConfig,
  selectReposForUpdate,
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