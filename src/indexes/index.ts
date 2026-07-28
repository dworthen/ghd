import { UserConfig, UserConfigPath } from '../userConfig'
import { getGithubToken } from '../utils/github-token'
import { isPlainRecord, isRecord } from '../utils/parsing'

export type Primitive =
  | string
  | number
  | bigint
  | boolean
  | symbol
  | null
  | undefined

export type IndexRecord = {
  metadata?: Record<string, Primitive | Primitive[]>
  description: string
  include: string[]
  exclude: string[]
  outputDirectory: string
}

export type Index = {
  repos: Record<string, IndexRecord>
}

export type ParsedIndexLocation = {
  repo: string
  path: string
}

export interface LoadRemoteIndexDependencies {
  fetch?: typeof globalThis.fetch
  getGithubToken?: (repo: string) => Promise<string>
}

export type IndexLike<T> = {
  repos: Record<string, T>
}

export interface LoadIndexesDependencies<T>
  extends LoadRemoteIndexDependencies {
  configPath?: string
  indexes?: string[]
  loadIndex?: (
    index: string,
    dependencies: LoadRemoteIndexDependencies,
  ) => Promise<IndexLike<T>>
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
    throw new Error(
      `Invalid index '${index}'. Expected OWNER/REPO/path/to/index.yaml.`,
    )
  }

  return {
    repo: `${owner}/${repo}`,
    path: pathParts.join('/'),
  }
}

export function isIndex(value: unknown): value is Index {
  if (!isRecord(value) || !isPlainRecord(value.repos)) return false

  return Object.entries(value.repos).every(
    ([slug, entry]) =>
      isGithubSlug(slug) &&
      isRecord(entry) &&
      (!('metadata' in entry) || isMetadata(entry.metadata)) &&
      typeof entry.description === 'string' &&
      isStringArray(entry.include) &&
      isStringArray(entry.exclude) &&
      typeof entry.outputDirectory === 'string',
  )
}

export function parseIndex(contents: string, index: string): Index {
  let parsed: unknown
  try {
    parsed = Bun.YAML.parse(contents)
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : ''
    throw new Error(`Index ${index} is not valid YAML${detail}`)
  }

  if (!isIndex(parsed)) {
    throw new Error(`Index ${index} does not have the expected structure.`)
  }

  return parsed
}

export class IndexNotFoundError extends Error {}

export async function loadRemoteIndex(
  index: string,
  dependencies: LoadRemoteIndexDependencies = {},
): Promise<Index> {
  const location = parseIndexLocation(index)
  const getToken = dependencies.getGithubToken ?? getGithubToken
  const request = dependencies.fetch ?? globalThis.fetch
  let token: string
  try {
    token = await getToken(location.repo)
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === `No GitHub CLI token can access ${location.repo}`
    ) {
      throw new IndexNotFoundError(
        `Failed to get index ${index} from GitHub because ${location.repo} was not found or accessible.`,
      )
    }
    throw error
  }
  const [owner, repo] = location.repo.split('/')
  const encodedPath = location.path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  const url = `https://api.github.com/repos/${encodeURIComponent(owner ?? '')}/${encodeURIComponent(repo ?? '')}/contents/${encodedPath}`

  let response: Response
  try {
    response = await request(url, {
      headers: {
        Accept: 'application/vnd.github.raw+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2026-03-10',
      },
    })
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : ''
    throw new Error(`Failed to get index ${index} from GitHub${detail}`)
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new IndexNotFoundError(
        `Failed to get index ${index} from GitHub (HTTP 404).`,
      )
    }
    throw new Error(
      `Failed to get index ${index} from GitHub (HTTP ${response.status}).`,
    )
  }

  return parseIndex(await response.text(), index)
}

export async function loadIndexes<T = IndexRecord>(
  indexes?: string[],
  dependencies: LoadIndexesDependencies<T> = {},
): Promise<IndexLike<T>> {
  let selectedIndexes = indexes ?? dependencies.indexes
  if (selectedIndexes === undefined) {
    const configPath = dependencies.configPath ?? UserConfigPath
    if (!(await Bun.file(configPath).exists())) {
      throw new Error(`Configuration file not found at ${configPath}.`)
    }
    selectedIndexes = (await new UserConfig(configPath).read()).indexes
  }
  const loadIndex =
    dependencies.loadIndex ??
    (loadRemoteIndex as unknown as (
      index: string,
      dependencies: LoadRemoteIndexDependencies,
    ) => Promise<IndexLike<T>>)
  const repos: Record<string, T> = {}

  for (const index of selectedIndexes) {
    const loaded = await loadIndex(index, dependencies)
    Object.assign(repos, loaded.repos)
  }

  return { repos }
}

function isGithubSlug(value: string): boolean {
  const parts = value.split('/')
  return parts.length >= 2 && parts.every((part) => part.length > 0)
}

export function isMetadata(
  value: unknown,
): value is Record<string, Primitive | Primitive[]> {
  return (
    isPlainRecord(value) &&
    Object.values(value).every((item) =>
      Array.isArray(item) ? item.every(isPrimitive) : isPrimitive(item),
    )
  )
}

function isPrimitive(value: unknown): value is Primitive {
  return (
    value === null || (typeof value !== 'object' && typeof value !== 'function')
  )
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}