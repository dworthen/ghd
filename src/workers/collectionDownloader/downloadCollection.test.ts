import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Index } from '../../index/index'
import { hashStringToHex } from '../../utils/hash'
import { downloadCollection } from './downloadCollection'

const temporaryDirectories: string[] = []

async function temporaryCollectionDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ghd-collection-worker-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

const repoDirectory = 'msr-central/deworthe-skills/.agents/skills/create-plan'
const description =
  'Implementation planning. Create structured, phased markdown plans for new features or changes. Use this skill when the user wants to plan work, break down a feature, create an implementation plan, or structure a task before coding. Also use when the user says "create a plan", "plan this", "break this down", "implementation plan", "how should I approach this", or asks to think through a change before implementing it. USE FOR: create plan; implementation plan; plan feature; break down task; plan changes; structure work; phased plan; plan this out; approach for implementing.'

function record(overrides: Partial<Index[number]> = {}): Index[number] {
  return {
    repoDirectory,
    collection: 'skill',
    include: ['**/*'],
    exclude: [],
    outputDirectory: '.agents/skills/create-plan',
    description,
    ...overrides,
  }
}

describe('downloadCollection', () => {
  test('writes the literal example to its collection and repo hash path character-for-character', async () => {
    const collectionDirectory = await temporaryCollectionDirectory()
    const result = await downloadCollection([record()], {
      collectionCache: {},
      collectionDirectory,
    })
    const path = join(
      collectionDirectory,
      'skill',
      `${hashStringToHex(repoDirectory)}.md`,
    )

    expect(hashStringToHex(repoDirectory)).toBe('dbecff4c4d3682a7')
    expect(await Bun.file(path).text()).toBe(
      `# ${repoDirectory}\n\n${description}`,
    )
    expect(result).toEqual({
      [repoDirectory]: hashStringToHex(description),
    })
  })

  test('maps the whole collection, partitions files, and preserves raw text', async () => {
    const collectionDirectory = await temporaryCollectionDirectory()
    const records: Index = [
      record({
        repoDirectory: 'owner/repo/path one',
        collection: 'first',
        description: '  leading\ntrailing  ',
      }),
      record({
        repoDirectory: 'owner/repo/path-two',
        collection: 'second',
        description: '',
      }),
    ]
    const result = await downloadCollection(records, {
      collectionCache: {},
      collectionDirectory,
    })

    for (const item of records) {
      const path = join(
        collectionDirectory,
        item.collection,
        `${hashStringToHex(item.repoDirectory)}.md`,
      )
      expect(await Bun.file(path).text()).toBe(
        `# ${item.repoDirectory}\n\n${item.description}`,
      )
      expect(result[item.repoDirectory]).toBe(hashStringToHex(item.description))
    }
  })

  test('returns cached hashes without rewriting matching records', async () => {
    const collectionDirectory = await temporaryCollectionDirectory()
    const item = record()
    const path = join(
      collectionDirectory,
      item.collection,
      `${hashStringToHex(item.repoDirectory)}.md`,
    )
    await Bun.write(path, 'sentinel that must not be rewritten')
    const descriptionHash = hashStringToHex(item.description)

    const result = await downloadCollection([item], {
      collectionCache: { [item.repoDirectory]: descriptionHash },
      collectionDirectory,
    })

    expect(result).toEqual({ [item.repoDirectory]: descriptionHash })
    expect(await Bun.file(path).text()).toBe(
      'sentinel that must not be rewritten',
    )
  })

  test('rewrites a file whose cached hash no longer matches', async () => {
    const collectionDirectory = await temporaryCollectionDirectory()
    const item = record({ description: 'fresh description' })
    const path = join(
      collectionDirectory,
      item.collection,
      `${hashStringToHex(item.repoDirectory)}.md`,
    )
    await Bun.write(path, 'stale contents')

    const result = await downloadCollection([item], {
      collectionCache: { [item.repoDirectory]: 'stale-hash' },
      collectionDirectory,
    })

    expect(result).toEqual({
      [item.repoDirectory]: hashStringToHex(item.description),
    })
    expect(await Bun.file(path).text()).toBe(
      `# ${item.repoDirectory}\n\n${item.description}`,
    )
  })

  test('accepts records with unrelated optional values omitted at runtime', async () => {
    const collectionDirectory = await temporaryCollectionDirectory()
    const minimal = {
      repoDirectory: 'owner/repo/minimal',
      collection: 'minimal',
      description: 'verbatim',
    } as Index[number]
    await expect(
      downloadCollection([minimal], {
        collectionCache: {},
        collectionDirectory,
      }),
    ).resolves.toEqual({
      'owner/repo/minimal': hashStringToHex('verbatim'),
    })
  })
})