import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type IndexRecord } from '../../index/index'
import { printRecord, viewIndexes } from './view'

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

const record = (
  repoDirectory: string,
  description: string,
  collection = 'tools',
): IndexRecord => ({
  repoDirectory,
  collection,
  description,
  include: [],
  exclude: [],
  outputDirectory: description,
})

describe('viewIndexes', () => {
  test('loads configured indexes through a manager and prints each record in order', async () => {
    const configPath = await temporaryConfig(
      'indexes: [owner/one/index.yaml, owner/two/index.yaml]\n',
    )
    const receivedIndexes: string[][] = []
    class Manager {
      constructor(indexes: string[]) {
        receivedIndexes.push(indexes)
      }

      async *records(): AsyncIterableIterator<IndexRecord> {
        yield record('owner/one', ' first ', 'tools')
        yield record('owner/two/path', 'second', 'templates')
      }
    }
    const calls: unknown[][] = []

    const result = await viewIndexes({
      configPath,
      manager: Manager,
      log: (...values) => calls.push(values),
    })

    expect(result).toBeUndefined()
    expect(receivedIndexes).toEqual([
      ['owner/one/index.yaml', 'owner/two/index.yaml'],
    ])
    expect(calls).toEqual([
      ['repoDirectory: owner/one'],
      ['  collection: tools'],
      ['  description:  first '],
      ['repoDirectory: owner/two/path'],
      ['  collection: templates'],
      ['  description: second'],
    ])
  })

  test('accepts an empty configured list without printing records', async () => {
    const configPath = await temporaryConfig('indexes: []\n')
    const calls: unknown[][] = []
    class Manager {
      constructor(indexes: string[]) {
        expect(indexes).toEqual([])
      }

      async *records(): AsyncIterableIterator<IndexRecord> {}
    }

    await viewIndexes({
      configPath,
      manager: Manager,
      log: (...values) => calls.push(values),
    })
    expect(calls).toEqual([])
  })
})

describe('printRecord', () => {
  test('prints labeled values on separate lines with nested fields indented', () => {
    const calls: unknown[][] = []
    const log = (...values: unknown[]) => calls.push(values)

    printRecord(record('owner/repo', ' desc ', ' collection '), log)

    expect(calls).toEqual([
      ['repoDirectory: owner/repo'],
      ['  collection:  collection '],
      ['  description:  desc '],
    ])
  })
})