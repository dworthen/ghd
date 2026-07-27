import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  configuredIndex,
  configuredIndexes,
  isConfig,
  loadConfig,
  parseConfig,
  parseConfigDocument,
  saveConfig,
  withConfiguredIndex,
} from './index'

const temporaryDirectories: string[] = []

async function temporaryConfigPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ghd-config-'))
  temporaryDirectories.push(directory)
  return join(directory, '.ghd', 'ghd.config.yaml')
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('Config', () => {
  test('requires an indexes record mapping names to strings', () => {
    const config = {
      indexes: {
        main: 'owner/repo/index.yaml',
        secondary: 'other/repo/index.yaml',
      },
    }

    expect(isConfig(config)).toBe(true)
    expect(isConfig({ indexes: {} })).toBe(true)
    expect(isConfig({ index: 'owner/repo/index.yaml' })).toBe(false)
    expect(isConfig({ indexes: [] })).toBe(false)
    expect(isConfig({ indexes: { main: 42 } })).toBe(false)
  })

  test.each([
    ['Date', new Date(0)],
    ['Map', new Map()],
    ['Set', new Set()],
    ['RegExp', /index/],
  ])('rejects a %s indexes container', (_, indexes) => {
    expect(isConfig({ indexes })).toBe(false)
    expect(() => configuredIndexes({ indexes }, 'config.yaml')).toThrow(
      'No indexes are configured in config.yaml.',
    )
  })

  test('accepts an indexes record with a null prototype', () => {
    const indexes: Record<string, string> = Object.create(null)
    indexes.main = 'owner/repo/index.yaml'
    expect(isConfig({ indexes })).toBe(true)
    expect(configuredIndexes({ indexes }, 'config.yaml')).toBe(indexes)
  })

  test('parses multiple configured indexes without rewriting values', () => {
    expect(
      parseConfig(
        "indexes:\n  main: owner/repo/index.yaml\n  spaced: '  other/repo/index.yaml  '\n",
        'config.yaml',
      ),
    ).toEqual({
      indexes: {
        main: 'owner/repo/index.yaml',
        spaced: '  other/repo/index.yaml  ',
      },
    })
    expect(parseConfigDocument('', 'config.yaml')).toEqual({})
    expect(parseConfig('indexes: {}\n', 'config.yaml')).toEqual({ indexes: {} })
  })

  test('loads and saves Config while preserving additional fields', async () => {
    const path = await temporaryConfigPath()
    let config = withConfiguredIndex(
      { other: 'preserved' },
      'main',
      'owner/repo/index.yaml',
    )
    config = withConfiguredIndex(config, 'docs', 'owner/docs/index.yaml')

    await saveConfig(config, path)

    expect(await loadConfig(path)).toEqual({
      indexes: {
        main: 'owner/repo/index.yaml',
        docs: 'owner/docs/index.yaml',
      },
      other: 'preserved',
    })
  })

  test('returns the mapping and requested value by identity and verbatim', () => {
    const indexes = { main: '  custom index  ' }
    const config = { indexes }

    expect(configuredIndexes(config, 'config.yaml')).toBe(indexes)
    expect(configuredIndex(config, 'main', 'config.yaml')).toBe(
      '  custom index  ',
    )
  })

  test.each(['', '{}', 'indexes: []\n', 'indexes:\n  main: 42\n'])(
    'rejects a document without a usable indexes string record: %p',
    (contents) => {
      expect(() => parseConfig(contents, 'config.yaml')).toThrow(
        'No indexes are configured in config.yaml.',
      )
    },
  )

  test.each(['missing', 'toString', 'constructor'])(
    'reports unknown requested index name %p without reading inherited keys',
    (name) => {
      expect(() =>
        configuredIndex(
          { indexes: { main: 'owner/repo/index.yaml' } },
          name,
          'config.yaml',
        ),
      ).toThrow(`Index '${name}' is not configured in config.yaml.`)
    },
  )
})