import { describe, expect, test } from 'bun:test'
import { type GhdConfig, mergeConfig, type RepoConfig } from './config'

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