import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  FileAlreadyExistsError,
  FileNotLoadedError,
  ValidationError,
} from '../errors'
import {
  type CollectionCache,
  CollectionCacheService,
  isCollectionCache,
} from './index'

const temporaryDirectories: string[] = []

async function temporaryCachePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ghd-collection-cache-'))
  temporaryDirectories.push(directory)
  return join(directory, 'nested', 'cache.yaml')
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('CollectionCache validation', () => {
  test('accepts indexes with numeric timestamps and files with string hashes', () => {
    expect(
      isCollectionCache({ indexes: { index: 123 }, files: { repo: 'hash' } }),
    ).toBe(true)
    expect(isCollectionCache({ indexes: {}, files: {} })).toBe(true)
    expect(isCollectionCache({ indexes: [], files: {} })).toBe(false)
    expect(isCollectionCache({ indexes: { index: '123' }, files: {} })).toBe(
      false,
    )
    expect(isCollectionCache({ indexes: {}, files: { repo: 1 } })).toBe(false)
    expect(isCollectionCache({ indexes: {}, files: {} })).toBe(true)
    expect(isCollectionCache(null)).toBe(false)
  })

  test('rejects validation before the cache is loaded', async () => {
    const path = await temporaryCachePath()
    expect(() => new CollectionCacheService(path).validate()).toThrow(
      `Collection cache at ${resolve(path)} has not been loaded.`,
    )
  })
})

describe('CollectionCacheService read and save', () => {
  test.each([undefined, '', '  \n'])(
    'returns an empty CollectionCache for missing or empty content %p',
    async (contents) => {
      const path = await temporaryCachePath()
      if (contents !== undefined) await Bun.write(path, contents)
      const cache = await new CollectionCacheService(path).read()
      expect(cache).toEqual({ indexes: {}, files: {} })
      expect(Object.getPrototypeOf(cache)).toBe(Object.prototype)
    },
  )

  test('parses valid YAML verbatim, caches by identity, and writes mutations', async () => {
    const path = await temporaryCachePath()
    await Bun.write(
      path,
      "indexes:\n  ' owner/index ': 123\nfiles:\n  ' owner/repo ': 00Ab\n  owner/other: deadbeef\n",
    )
    const service = new CollectionCacheService(path)
    const first = await service.read()
    await Bun.write(path, 'changed: ignored\n')
    const second = await service.read()
    expect(second).toBe(first)
    expect(second).toEqual({
      indexes: { ' owner/index ': 123 },
      files: {
        ' owner/repo ': '00Ab',
        'owner/other': 'deadbeef',
      },
    })

    first.files['new/repo'] = '1234'
    await service.save()
    expect(Bun.YAML.parse(await Bun.file(path).text())).toEqual(first)
  })

  test.each([
    '- item\n',
    'indexes: []\nfiles: {}\n',
    'indexes:\n  index: string\nfiles: {}\n',
    'indexes: {}\nfiles:\n  repo: 42\n',
    'indexes: {}\n',
  ])('rejects an invalid cache mapping %p', async (contents) => {
    const path = await temporaryCachePath()
    await Bun.write(path, contents)
    await expect(
      new CollectionCacheService(path).read(),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  test('wraps malformed YAML in ValidationError', async () => {
    const path = await temporaryCachePath()
    await Bun.write(path, 'repo: [unterminated')
    await expect(
      new CollectionCacheService(path).read(),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  test('requires loading before save unless saveEmpty is requested', async () => {
    const path = await temporaryCachePath()
    const service = new CollectionCacheService(path)
    await expect(service.save()).rejects.toBeInstanceOf(FileNotLoadedError)
    await service.save(false, true)
    expect(await Bun.file(path).text()).toBe('')
  })

  test('honors throwIfExists without overwriting', async () => {
    const path = await temporaryCachePath()
    await Bun.write(path, 'original')
    await expect(
      new CollectionCacheService(path).save(true, true),
    ).rejects.toBeInstanceOf(FileAlreadyExistsError)
    expect(await Bun.file(path).text()).toBe('original')
  })

  test('returns a CollectionCache type by identity', async () => {
    const path = await temporaryCachePath()
    const cache: CollectionCache = await new CollectionCacheService(path).read()
    expect(cache.constructor).toBe(Object)
  })
})