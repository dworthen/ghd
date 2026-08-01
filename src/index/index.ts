import { type DataReader, type DataValidator } from '../DataManager'
import {
  GithubRequestError,
  IndexNotFoundError,
  ValidationError,
} from '../errors'
import { getGithubToken } from '../utils/github-token'
import { hashStringToHex } from '../utils/hash'

export { GithubRequestError, IndexNotFoundError } from '../errors'

import { isPlainRecord } from '../utils/parsing'

export type IndexRecord = {
  [key: string]: unknown
  repoDirectory: string
  collection: string
  description: string
  include: string[]
  exclude: string[]
  outputDirectory: string
}

export type Index = IndexRecord[]

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>
export type ParsedIndexLocation = {
  repo: string
  path: string
}

export interface LoadRemoteIndexDependencies {
  fetch?: typeof globalThis.fetch
  getGithubToken?: (repo: string) => Promise<string>
}

export function parseIndexLocation(index: string): ParsedIndexLocation {
  const [owner, repo, ...pathParts] = index.split('/')
  if (
    !owner ||
    !repo ||
    pathParts.length === 0 ||
    pathParts.some((part) => !part) ||
    !pathParts.at(-1)?.endsWith('.yaml')
  ) {
    throw new ValidationError(
      `Invalid index '${index}'. Expected OWNER/REPO/path/to/index.yaml.`,
    )
  }

  return {
    repo: `${owner}/${repo}`,
    path: pathParts.join('/'),
  }
}

export function isIndex(value: unknown): value is Index {
  return Array.isArray(value) && value.every(isIndexRecord)
}

export function parseIndex(contents: string, index: string): Index {
  let parsed: unknown
  try {
    parsed = Bun.YAML.parse(contents)
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : ''
    throw new ValidationError(`Index ${index} is not valid YAML${detail}`)
  }

  if (!isIndex(parsed)) {
    throw new ValidationError(
      `Index ${index} does not have the expected structure.`,
    )
  }

  return parsed
}

export class IndexReader implements DataReader<string>, DataValidator {
  #indexSlug: string
  #contents: string | null = null
  #getGithubToken: (repo: string) => Promise<string>
  #fetch: Fetch

  constructor(
    index: string,
    tokenGetter: (repo: string) => Promise<string> = getGithubToken,
    request: Fetch = globalThis.fetch,
  ) {
    this.#indexSlug = index
    this.#getGithubToken = tokenGetter
    this.#fetch = request
  }

  async read(): Promise<string> {
    if (this.#contents !== null) return this.#contents
    const location = parseIndexLocation(this.#indexSlug)
    let token: string
    try {
      token = await this.#getGithubToken(location.repo)
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === `No GitHub CLI token can access ${location.repo}`
      ) {
        throw new IndexNotFoundError(
          `Failed to get index ${this.#indexSlug} from GitHub because ${location.repo} was not found or accessible.`,
        )
      }
      const detail = error instanceof Error ? `: ${error.message}` : ''
      throw new GithubRequestError(
        `Failed to get a GitHub token for index ${this.#indexSlug}${detail}`,
      )
    }

    const [owner, repo] = location.repo.split('/')
    const encodedPath = location.path
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/')
    const url = `https://api.github.com/repos/${encodeURIComponent(owner ?? '')}/${encodeURIComponent(repo ?? '')}/contents/${encodedPath}`

    let response: Response
    try {
      response = await this.#fetch(url, {
        headers: {
          Accept: 'application/vnd.github.raw+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2026-03-10',
        },
      })
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : ''
      throw new GithubRequestError(
        `Failed to get index ${this.#indexSlug} from GitHub${detail}`,
      )
    }

    if (!response.ok) {
      if (response.status === 404) {
        throw new IndexNotFoundError(
          `Failed to get index ${this.#indexSlug} from GitHub (HTTP 404).`,
        )
      }
      throw new GithubRequestError(
        `Failed to get index ${this.#indexSlug} from GitHub (HTTP ${response.status}).`,
      )
    }

    try {
      this.#contents = await response.text()
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : ''
      throw new GithubRequestError(
        `Failed to read index ${this.#indexSlug} from GitHub${detail}`,
      )
    }

    try {
      this.validate()
    } catch (error) {
      this.#contents = null
      throw error
    }
    return this.#contents
  }

  validate(): void {
    if (this.#contents === null) {
      throw new ValidationError(`Index ${this.#indexSlug} has not been loaded.`)
    }
    parseIndex(this.#contents, this.#indexSlug)
  }
}

export interface IndexManager {
  indexes(): AsyncIterableIterator<string>
  hash(index: string): Promise<string>
  records(index: string): AsyncIterableIterator<IndexRecord>
}

export class DefaultIndexManager implements IndexManager {
  #indexSlugs: string[]
  #indexReaderConstructor: Constructor<DataReader<string>>
  #indexReaders = new Map<string, DataReader<string>>()

  constructor(
    indexes: string[],
    cstor: Constructor<DataReader<string>> = IndexReader,
  ) {
    this.#indexSlugs = indexes
    this.#indexReaderConstructor = cstor
  }

  async *indexes(): AsyncIterableIterator<string> {
    yield* this.#indexSlugs
  }

  async hash(index: string): Promise<string> {
    return hashStringToHex(await this.#reader(index).read())
  }

  async *records(index: string): AsyncIterableIterator<IndexRecord> {
    yield* parseIndex(await this.#reader(index).read(), index)
  }

  #reader(index: string): DataReader<string> {
    let reader = this.#indexReaders.get(index)
    if (reader === undefined) {
      reader = new this.#indexReaderConstructor(index)
      this.#indexReaders.set(index, reader)
    }
    return reader
  }
}

export async function loadRemoteIndex(
  index: string,
  dependencies: LoadRemoteIndexDependencies = {},
): Promise<Index> {
  const contents = await new IndexReader(
    index,
    dependencies.getGithubToken,
    dependencies.fetch,
  ).read()
  return parseIndex(contents, index)
}

function isIndexRecord(value: unknown): value is IndexRecord {
  return (
    isPlainRecord(value) &&
    isGithubSlug(value.repoDirectory) &&
    typeof value.collection === 'string' &&
    typeof value.description === 'string' &&
    isStringArray(value.include) &&
    isStringArray(value.exclude) &&
    typeof value.outputDirectory === 'string'
  )
}

function isGithubSlug(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parts = value.split('/')
  return parts.length >= 2 && parts.every((part) => part.length > 0)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}