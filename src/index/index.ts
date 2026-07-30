import { type DataReader, type DataValidator } from '../DataManager'
import {
  GithubRequestError,
  IndexNotFoundError,
  ValidationError,
} from '../errors'
import { getGithubToken } from '../utils/github-token'

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

export class IndexReader implements DataReader<Index>, DataValidator {
  #indexSlug: string
  #index: Index | null = null
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

  async read(): Promise<Index> {
    if (this.#index !== null) return this.#index

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

    let contents: string
    try {
      contents = await response.text()
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : ''
      throw new GithubRequestError(
        `Failed to read index ${this.#indexSlug} from GitHub${detail}`,
      )
    }

    try {
      this.#index = Bun.YAML.parse(contents) as Index
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : ''
      throw new ValidationError(
        `Index ${this.#indexSlug} is not valid YAML${detail}`,
      )
    }

    try {
      await this.validate()
    } catch (error) {
      this.#index = null
      throw error
    }
    return this.#index
  }

  validate(): void {
    if (this.#index === null) {
      throw new ValidationError(`Index ${this.#indexSlug} has not been loaded.`)
    }
    if (!isIndex(this.#index)) {
      throw new ValidationError(
        `Index ${this.#indexSlug} does not have the expected structure.`,
      )
    }
  }
}

export interface IndexManager {
  indexes(): AsyncIterableIterator<string>
  records(index: string): AsyncIterableIterator<IndexRecord>
}

export class DefaultIndexManager implements IndexManager {
  #indexSlugs: string[]
  #indexReaderConstructor: Constructor<DataReader<Index>>

  constructor(
    indexes: string[],
    cstor: Constructor<DataReader<Index>> = IndexReader,
  ) {
    this.#indexSlugs = indexes
    this.#indexReaderConstructor = cstor
  }

  async *indexes(): AsyncIterableIterator<string> {
    yield* this.#indexSlugs
  }

  async *records(index: string): AsyncIterableIterator<IndexRecord> {
    const records = await new this.#indexReaderConstructor(index).read()
    yield* records
  }
}

export async function loadRemoteIndex(
  index: string,
  dependencies: LoadRemoteIndexDependencies = {},
): Promise<Index> {
  return new IndexReader(
    index,
    dependencies.getGithubToken,
    dependencies.fetch,
  ).read()
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