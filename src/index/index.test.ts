import { describe, expect, test } from 'bun:test'
import {
  GithubRequestError,
  IndexNotFoundError,
  ValidationError,
} from '../errors'
import {
  DefaultIndexManager,
  type Index,
  IndexReader,
  type IndexRecord,
  isIndex,
  parseIndex,
  parseIndexLocation,
} from './index'

const record = (
  repoDirectory: string,
  description = 'Repository root',
  collection = 'tools',
): IndexRecord => ({
  repoDirectory,
  collection,
  description,
  include: ['**/*'],
  exclude: ['private/**'],
  outputDirectory: 'vendor',
})

describe('Index validation', () => {
  test('accepts an array of records with arbitrary additional fields', () => {
    const index: Index = [
      record('owner/repo'),
      {
        ...record('owner/repo/path/to/directory'),
        custom: { nested: true },
      },
    ]

    expect(Array.isArray(index)).toBe(true)
    expect(index[1]?.custom).toEqual({ nested: true })
    expect(isIndex(index)).toBe(true)
    expect(isIndex([])).toBe(true)
    expect(isIndex({ repos: {} })).toBe(false)
    expect(isIndex([record('owner')])).toBe(false)
  })

  test('requires every named IndexRecord field with the declared value type', () => {
    const valid = record('owner/repo')
    for (const key of [
      'repoDirectory',
      'collection',
      'description',
      'include',
      'exclude',
      'outputDirectory',
    ] as const) {
      const invalid = { ...valid }
      Reflect.deleteProperty(invalid, key)
      expect(isIndex([invalid])).toBe(false)
    }
    expect(isIndex([{ ...valid, include: [1] }])).toBe(false)
    expect(isIndex([{ ...valid, collection: 1 }])).toBe(false)
  })

  test('parses a list without deduplicating, reordering, or normalizing text', () => {
    const parsed = parseIndex(
      `- repoDirectory: 'owner/repo/  src  '\n  collection: ' duplicated type '\n  description: ' first '\n  include: [' z ', z]\n  exclude: []\n  outputDirectory: ' out '\n- repoDirectory: owner/repo/src\n  collection: tools\n  description: second\n  include: []\n  exclude: []\n  outputDirectory: out\n- repoDirectory: owner/repo/src\n  collection: tools\n  description: duplicate\n  include: []\n  exclude: []\n  outputDirectory: out\n`,
      'owner/index/catalog.yaml',
    )

    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.map((item) => item.repoDirectory)).toEqual([
      'owner/repo/  src  ',
      'owner/repo/src',
      'owner/repo/src',
    ])
    expect(parsed[0]).toEqual({
      repoDirectory: 'owner/repo/  src  ',
      collection: ' duplicated type ',
      description: ' first ',
      include: [' z ', 'z'],
      exclude: [],
      outputDirectory: ' out ',
    })
  })

  test('uses ValidationError for malformed YAML and invalid structures', () => {
    expect(() => parseIndex('- [', 'owner/repo/index.yaml')).toThrow(
      ValidationError,
    )
    expect(() => parseIndex('{}', 'owner/repo/index.yaml')).toThrow(
      'Index owner/repo/index.yaml does not have the expected structure.',
    )
    expect(() => parseIndex('{}', 'owner/repo/index.yaml')).toThrow(
      ValidationError,
    )
  })
})

describe('IndexReader', () => {
  test('gets a token, downloads, validates, and caches the same list identity', async () => {
    const repositories: string[] = []
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const request = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(input), init })
      return new Response(
        `- repoDirectory: octo-org/project/packages/app\n  collection: app\n  description: Application package\n  include: ['**/*.ts']\n  exclude: ['**/*.test.ts']\n  outputDirectory: packages/app\n`,
      )
    }
    const reader = new IndexReader(
      'octo-org/indexes/catalogs/main index.yaml',
      async (repo) => {
        repositories.push(repo)
        return 'secret-token'
      },
      request,
    )

    expect(() => reader.validate()).toThrow(ValidationError)
    const first = await reader.read()
    const second = await reader.read()

    expect(first).toBe(second)
    expect(Array.isArray(first)).toBe(true)
    expect(first[0]?.repoDirectory).toBe('octo-org/project/packages/app')
    expect(repositories).toEqual(['octo-org/indexes'])
    expect(requests).toEqual([
      {
        url: 'https://api.github.com/repos/octo-org/indexes/contents/catalogs/main%20index.yaml',
        init: {
          headers: {
            Accept: 'application/vnd.github.raw+json',
            Authorization: 'Bearer secret-token',
            'X-GitHub-Api-Version': '2026-03-10',
          },
        },
      },
    ])
  })

  test('validates within read and uses custom errors', async () => {
    const invalid = new IndexReader(
      'owner/repo/index.yaml',
      async () => 'token',
      async () => new Response('{}'),
    )
    await expect(invalid.read()).rejects.toThrow(ValidationError)
    expect(() => invalid.validate()).toThrow(ValidationError)

    const missing = new IndexReader(
      'owner/repo/index.yaml',
      async () => 'token',
      async () => new Response('', { status: 404 }),
    )
    await expect(missing.read()).rejects.toThrow(IndexNotFoundError)

    const failed = new IndexReader(
      'owner/repo/index.yaml',
      async () => 'token',
      async () => new Response('', { status: 500 }),
    )
    await expect(failed.read()).rejects.toThrow(GithubRequestError)
  })

  test('uses the injected token getter and maps inaccessible repos to IndexNotFoundError', async () => {
    const reader = new IndexReader('owner/repo/index.yaml', async () => {
      throw new Error('No GitHub CLI token can access owner/repo')
    })
    await expect(reader.read()).rejects.toThrow(IndexNotFoundError)
  })

  test('wraps other token getter failures in GithubRequestError', async () => {
    const reader = new IndexReader('owner/repo/index.yaml', async () => {
      throw new Error('token backend unavailable')
    })

    await expect(reader.read()).rejects.toThrow(GithubRequestError)
    await expect(reader.read()).rejects.toThrow(
      'Failed to get a GitHub token for index owner/repo/index.yaml: token backend unavailable',
    )
  })

  test.each([
    'owner',
    'owner/repo',
    '/repo/index.yaml',
    'owner/repo/index.yml',
  ])('rejects invalid location %p with ValidationError', (location) => {
    expect(() => parseIndexLocation(location)).toThrow(ValidationError)
  })
})

describe('DefaultIndexManager', () => {
  test('maps every slug and yields all records in index and record order, preserving duplicates', async () => {
    const constructed: string[] = []
    const read: string[] = []
    class Reader {
      #slug: string

      constructor(slug: string) {
        this.#slug = slug
        constructed.push(slug)
      }

      async read(): Promise<Index> {
        read.push(this.#slug)
        return [
          record(`${this.#slug}/first`, this.#slug),
          record(`${this.#slug}/second`, this.#slug),
        ]
      }
    }
    const slugs = [
      'owner/one/index.yaml',
      'owner/one/index.yaml',
      'owner/two/index.yaml',
    ]
    const manager = new DefaultIndexManager(slugs, Reader)
    const indexes: string[] = []
    const records: IndexRecord[] = []

    for await (const index of manager.indexes()) {
      indexes.push(index)
      for await (const item of manager.records(index)) records.push(item)
    }

    expect(indexes).toEqual(slugs)
    expect(constructed).toEqual(slugs)
    expect(read).toEqual(slugs)
    expect(records.map((item) => item.repoDirectory)).toEqual([
      'owner/one/index.yaml/first',
      'owner/one/index.yaml/second',
      'owner/one/index.yaml/first',
      'owner/one/index.yaml/second',
      'owner/two/index.yaml/first',
      'owner/two/index.yaml/second',
    ])
  })
})