import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  type DataReader,
  type DataValidator,
  type DataWriter,
} from '../DataManager'
import {
  FileAlreadyExistsError,
  FileNotLoadedError,
  ValidationError,
} from '../errors'
import { CollectionCachePath } from '../paths'
import { isPlainRecord, isStringRecord } from '../utils/parsing'

// File hashes are keyed by repo directory; index timestamps record successful pulls.
export type CollectionCache = {
  indexes: Record<string, number>
  files: Record<string, string>
}

export function isCollectionCache(value: unknown): value is CollectionCache {
  return (
    isPlainRecord(value) &&
    isNumberRecord(value.indexes) &&
    isStringRecord(value.files)
  )
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return (
    isPlainRecord(value) &&
    Object.values(value).every((item) => typeof item === 'number')
  )
}

export class CollectionCacheService
  implements DataReader<CollectionCache>, DataWriter, DataValidator
{
  #collectionCachePath: string
  #collectionCache: CollectionCache | null = null

  constructor(collectionCachePath: string = CollectionCachePath) {
    this.#collectionCachePath = resolve(collectionCachePath)
  }

  async read(): Promise<CollectionCache> {
    if (this.#collectionCache !== null) return this.#collectionCache

    const file = Bun.file(this.#collectionCachePath)
    if (!(await file.exists())) {
      this.#collectionCache = { indexes: {}, files: {} }
      return this.#collectionCache
    }

    const contents = await file.text()
    if (contents.trim() === '') {
      this.#collectionCache = { indexes: {}, files: {} }
      return this.#collectionCache
    }

    let parsed: unknown
    try {
      parsed = Bun.YAML.parse(contents)
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : ''
      throw new ValidationError(
        `Collection cache at ${this.#collectionCachePath} is not valid YAML${detail}`,
      )
    }

    this.#collectionCache = parsed as CollectionCache
    try {
      await this.validate()
    } catch (error) {
      this.#collectionCache = null
      throw error
    }
    return this.#collectionCache
  }

  validate(): void {
    if (this.#collectionCache === null) {
      throw new ValidationError(
        `Collection cache at ${this.#collectionCachePath} has not been loaded.`,
      )
    }
    if (!isCollectionCache(this.#collectionCache)) {
      throw new ValidationError(
        `Collection cache at ${this.#collectionCachePath} must contain YAML mappings named indexes (numbers) and files (strings).`,
      )
    }
  }

  async save(
    throwIfExists: boolean = false,
    saveEmpty: boolean = false,
  ): Promise<void> {
    const file = Bun.file(this.#collectionCachePath)
    if (throwIfExists && (await file.exists())) {
      throw new FileAlreadyExistsError(
        `Collection cache already exists at ${this.#collectionCachePath}.`,
      )
    }
    if (this.#collectionCache === null && !saveEmpty) {
      throw new FileNotLoadedError(
        `Collection cache at ${this.#collectionCachePath} has not been loaded.`,
      )
    }

    await mkdir(dirname(this.#collectionCachePath), { recursive: true })
    if (this.#collectionCache === null) {
      await Bun.write(this.#collectionCachePath, '')
      return
    }

    this.validate()
    await Bun.write(
      this.#collectionCachePath,
      Bun.YAML.stringify(this.#collectionCache, null, 2),
    )
  }
}