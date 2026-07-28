import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listIndexes } from './list'

const temporaryDirectories: string[] = []

async function temporaryConfig(contents?: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ghd-indexes-list-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'ghd.config.yaml')
  if (contents !== undefined) await Bun.write(path, contents)
  return path
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('listIndexes', () => {
  test('loads and prints the configured index list as exact JSON by default', async () => {
    const indexes = ['owner/one/index.yaml', '  owner/two/index.yaml  ']
    const path = await temporaryConfig(
      "indexes: [owner/one/index.yaml, '  owner/two/index.yaml  ']\nother: preserved\n",
    )

    const output = await listIndexes(undefined, path)

    expect(typeof output).toBe('string')
    expect(output).toBe(JSON.stringify(indexes, null, 2))
  })

  test('prints the index list as exact YAML when requested', async () => {
    const indexes = ['owner/one/index.yaml', 'owner/two/index.yaml']
    const path = await temporaryConfig(
      'indexes: [owner/one/index.yaml, owner/two/index.yaml]\n',
    )

    expect(await listIndexes('yaml', path)).toBe(
      Bun.YAML.stringify(indexes, null, 2),
    )
  })

  test('prints an empty configured list in either format', async () => {
    const path = await temporaryConfig('indexes: []\n')

    expect(await listIndexes('json', path)).toBe('[]')
    expect(await listIndexes('yaml', path)).toBe('[]')
  })

  test('reports a missing default-style configuration path', async () => {
    const path = await temporaryConfig()

    await expect(listIndexes('json', path)).rejects.toThrow(
      `Configuration file not found at ${path}.`,
    )
  })
})