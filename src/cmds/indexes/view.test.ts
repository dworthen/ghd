import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Index } from '../../indexes'
import { stringifyIndex, viewIndexes } from './view'

const temporaryDirectories: string[] = []

async function temporaryConfig(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ghd-indexes-view-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'ghd.config.yaml')
  await Bun.write(path, contents)
  return path
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

const record = (description: string): Index['repos'][string] => ({
  description,
  include: [],
  exclude: [],
  outputDirectory: description,
})

describe('viewIndexes', () => {
  test('loads all configured indexes and merges them in configuration order', async () => {
    const configPath = await temporaryConfig(
      'indexes:\n  first: owner/one/index.yaml\n  second: owner/two/index.yaml\n',
    )
    const loaded: string[] = []
    const output = await viewIndexes(undefined, 'json', {
      configPath,
      loadIndex: async (location) => {
        loaded.push(location)
        const repos: Index['repos'] = location.includes('/one/')
          ? { 'owner/one': record('first') }
          : { 'owner/two': record('second') }
        return { repos }
      },
    })

    expect(loaded).toEqual(['owner/one/index.yaml', 'owner/two/index.yaml'])
    expect(JSON.parse(output)).toEqual({
      repos: {
        'owner/one': record('first'),
        'owner/two': record('second'),
      },
    })
  })

  test('filters by multiple names in caller order and later indexes win conflicts', async () => {
    const configPath = await temporaryConfig(
      'indexes:\n  first: owner/one/index.yaml\n  second: owner/two/index.yaml\n  third: owner/three/index.yaml\n',
    )
    const loaded: string[] = []
    const output = await viewIndexes(['third', 'first'], 'yaml', {
      configPath,
      loadIndex: async (location) => {
        loaded.push(location)
        return { repos: { 'owner/shared': record(location) } }
      },
    })

    expect(loaded).toEqual(['owner/three/index.yaml', 'owner/one/index.yaml'])
    expect(Bun.YAML.parse(output)).toEqual({
      repos: { 'owner/shared': record('owner/one/index.yaml') },
    })
  })

  test('preserves duplicate filter names rather than deduplicating them', async () => {
    const configPath = await temporaryConfig(
      'indexes:\n  first: owner/one/index.yaml\n',
    )
    const loaded: string[] = []
    await viewIndexes(['first', 'first'], 'json', {
      configPath,
      loadIndex: async (location) => {
        loaded.push(location)
        return { repos: {} }
      },
    })
    expect(loaded).toEqual(['owner/one/index.yaml', 'owner/one/index.yaml'])
  })

  test('permissively ignores unknown names and accepts an empty mapping', async () => {
    const configPath = await temporaryConfig('indexes: {}\n')
    await expect(
      viewIndexes(['missing', 'toString', 'constructor'], 'json', {
        configPath,
        loadIndex: async () => {
          throw new Error('must not load')
        },
      }),
    ).resolves.toBe('{\n  "repos": {}\n}')
  })
})

describe('stringifyIndex', () => {
  test('returns a string in the requested exact format', () => {
    const index: Index = { repos: { 'owner/repo': record('main') } }
    expect(stringifyIndex(index, 'json')).toBe(JSON.stringify(index, null, 2))
    expect(stringifyIndex(index, 'yaml')).toBe(
      Bun.YAML.stringify(index, null, 2),
    )
  })
})