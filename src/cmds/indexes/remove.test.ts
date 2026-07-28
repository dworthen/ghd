import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeIndex } from './remove'

const temporaryDirectories: string[] = []

async function temporaryConfig(contents?: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ghd-index-remove-'))
  temporaryDirectories.push(directory)
  const path = join(directory, '.ghd', 'ghd.config.yaml')
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

describe('removeIndex', () => {
  test('removes one index while preserving order and other fields', async () => {
    const configPath = await temporaryConfig(
      'indexes: [owner/one/index.yaml, owner/two/index.yaml, owner/three/index.yaml]\nother: preserved\n',
    )

    await removeIndex('owner/two/index.yaml', { configPath })

    expect(Bun.YAML.parse(await Bun.file(configPath).text())).toEqual({
      indexes: ['owner/one/index.yaml', 'owner/three/index.yaml'],
      other: 'preserved',
    })
  })

  test('leaves the file unchanged when the index is absent', async () => {
    const original = 'indexes: [owner/one/index.yaml]\nother: preserved\n'
    const configPath = await temporaryConfig(original)

    await removeIndex('owner/missing/index.yaml', { configPath })

    expect(await Bun.file(configPath).text()).toBe(original)
  })

  test('uses the empty default document when the config is missing', async () => {
    const configPath = await temporaryConfig()

    await removeIndex('owner/missing/index.yaml', { configPath })

    expect(await Bun.file(configPath).exists()).toBe(false)
  })
})