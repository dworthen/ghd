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
  test('loads and prints configured indexes as exact JSON by default', async () => {
    const indexes = {
      first: 'owner/one/index.yaml',
      spaced: '  owner/two/index.yaml  ',
    }
    const path = await temporaryConfig(
      "indexes:\n  first: owner/one/index.yaml\n  spaced: '  owner/two/index.yaml  '\nother: preserved\n",
    )

    const output = await listIndexes(undefined, path)

    expect(typeof output).toBe('string')
    expect(output).toBe(JSON.stringify(indexes, null, 2))
  })

  test('prints configured indexes as exact JSON when requested', async () => {
    const indexes = { main: 'owner/repo/index.yaml' }
    const path = await temporaryConfig(
      'indexes:\n  main: owner/repo/index.yaml\n',
    )

    expect(await listIndexes('json', path)).toBe(
      JSON.stringify(indexes, null, 2),
    )
  })

  test('prints configured indexes as exact YAML when requested', async () => {
    const indexes = {
      first: 'owner/one/index.yaml',
      second: 'owner/two/index.yaml',
    }
    const path = await temporaryConfig(
      'indexes:\n  first: owner/one/index.yaml\n  second: owner/two/index.yaml\n',
    )

    expect(await listIndexes('yaml', path)).toBe(
      Bun.YAML.stringify(indexes, null, 2),
    )
  })

  test('prints an empty configured mapping in either format', async () => {
    const path = await temporaryConfig('indexes: {}\n')

    expect(await listIndexes('json', path)).toBe('{}')
    expect(await listIndexes('yaml', path)).toBe('{}')
  })

  test('reports a missing default-style configuration path', async () => {
    const path = await temporaryConfig()

    await expect(listIndexes('json', path)).rejects.toThrow(
      `Configuration file not found at ${path}.`,
    )
  })
})