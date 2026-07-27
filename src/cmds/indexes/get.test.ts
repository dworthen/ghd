import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readIndex } from './get'

const temporaryDirectories: string[] = []

async function temporaryConfig(contents?: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ghd-indexes-get-'))
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

describe('readIndex', () => {
  test('returns the requested configured index verbatim', async () => {
    const path = await temporaryConfig(
      "indexes:\n  main: owner/repo/index.yaml\n  custom: '  custom index  '\n",
    )

    await expect(readIndex('main', path)).resolves.toBe('owner/repo/index.yaml')
    await expect(readIndex('custom', path)).resolves.toBe('  custom index  ')
  })

  test('throws when configuration or key is missing', async () => {
    const missing = await temporaryConfig()
    await expect(readIndex('main', missing)).rejects.toThrow(
      `Configuration file not found at ${missing}.`,
    )

    const path = await temporaryConfig(
      'indexes:\n  main: owner/repo/index.yaml\n',
    )
    await expect(readIndex('other', path)).rejects.toThrow(
      `Index 'other' is not configured in ${path}.`,
    )
  })
})