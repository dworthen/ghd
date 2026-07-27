import { lstat, mkdir, rm, unlink } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { Glob } from 'bun'
import { defaultConfigPath, loadConfigDocument } from '../config'
import {
  type Index,
  IndexNotFoundError,
  type IndexRecord,
  type LoadRemoteIndexDependencies,
  loadIndexes,
  loadRemoteIndex,
} from '../indexes'
import { type LocalConfig } from '../install/local-config'
import { getGithubToken } from '../utils/github-token'

const API_ROOT = 'https://api.github.com'
const API_VERSION = '2026-03-10'

export type { LocalConfig }

export type ParsedRepository = {
  owner: string
  repo: string
  path: string
  commit?: string
  slug: string
}

export type AddOptions = {
  include?: string[]
  exclude?: string[]
  index?: string[]
  config?: string
  force?: boolean
  cwd?: string
  record?: boolean
  loadGlobalIndex?: boolean
}
export type ResolvedAddOptions = {
  include: string[]
  exclude: string[]
  outputDirectory: string
}

export function resolveAddOptions(
  slug: string,
  indexed:
    | Pick<IndexRecord, 'include' | 'exclude' | 'outputDirectory'>
    | undefined,
  options: Pick<AddOptions, 'include' | 'exclude'> & {
    outputDirectory?: string
  },
  indexLoaded: boolean,
): ResolvedAddOptions {
  if (indexed !== undefined) {
    return {
      include: options.include ?? indexed.include,
      exclude: options.exclude ?? indexed.exclude,
      outputDirectory: options.outputDirectory ?? indexed.outputDirectory,
    }
  }

  const context = indexLoaded
    ? `No index entry found for ${slug}.`
    : 'No index is configured.'
  if (
    options.include === undefined ||
    !options.include.some((pattern) => pattern !== '')
  ) {
    throw new Error(`${context} Provide --include or configure an index.`)
  }
  if (options.outputDirectory === undefined || options.outputDirectory === '') {
    throw new Error(
      `${context} Provide --output-directory or configure an index.`,
    )
  }

  return {
    include: options.include,
    exclude: options.exclude ?? [],
    outputDirectory: options.outputDirectory,
  }
}

export type AddResult =
  | { status: 'skipped'; targetDirectory: string }
  | { status: 'no-files'; targetDirectory: string }
  | {
      status: 'downloaded'
      targetDirectory: string
      commit: string
      files: string[]
    }

export interface AddDependencies {
  fetch?: typeof globalThis.fetch
  getGithubToken?: (repo: string) => Promise<string>
  loadRemoteIndex?: (
    index: string,
    dependencies?: LoadRemoteIndexDependencies,
  ) => Promise<Index>
  globalConfigPath?: string
}

type GithubTreeEntry = { path?: unknown; type?: unknown; sha?: unknown }

export function parseRepositorySlug(value: string): ParsedRepository {
  const at = value.lastIndexOf('@')
  const hasCommit = at >= 0
  const slug = hasCommit ? value.slice(0, at) : value
  const commit = hasCommit ? value.slice(at + 1) : undefined
  const [owner, repo, ...pathParts] = slug.split('/')

  if (
    !owner ||
    !repo ||
    owner === '.' ||
    owner === '..' ||
    repo === '.' ||
    repo === '..' ||
    pathParts.some((part) => !part || part === '.' || part === '..') ||
    owner.includes('@') ||
    repo.includes('@') ||
    (hasCommit && !commit)
  ) {
    throw new Error(
      `Invalid repository '${value}'. Expected OWNER/REPO[/path/to/directory][@COMMIT_SHA].`,
    )
  }

  if (commit !== undefined && !/^[0-9a-f]+$/i.test(commit)) {
    throw new Error(
      `Invalid commit SHA '${commit}'. Tags and branches are not allowed.`,
    )
  }

  return {
    owner,
    repo,
    path: pathParts.join('/'),
    ...(commit === undefined ? {} : { commit }),
    slug,
  }
}

export function selectFiles(
  paths: string[],
  include: string[],
  exclude: string[],
): string[] {
  const includes = include.map((pattern) => new Glob(pattern))
  const excludes = exclude.map((pattern) => new Glob(pattern))

  return paths.filter(
    (path) =>
      includes.some((pattern) => pattern.match(path)) &&
      !excludes.some((pattern) => pattern.match(path)),
  )
}

export async function add(
  repository: string,
  outputDirectory: string | undefined,
  options: AddOptions = {},
  dependencies: AddDependencies = {},
): Promise<AddResult> {
  const source = parseRepositorySlug(repository)
  const cwd = options.cwd ?? process.cwd()

  const request = dependencies.fetch ?? globalThis.fetch
  const findToken = dependencies.getGithubToken ?? getGithubToken
  const getIndex = dependencies.loadRemoteIndex ?? loadRemoteIndex

  let index: Index | undefined
  const hasExplicitInclude =
    options.include?.some((pattern) => pattern !== '') === true
  const canRunWithoutIndex =
    hasExplicitInclude &&
    outputDirectory !== undefined &&
    outputDirectory !== ''
  if (
    hasExplicitInclude &&
    outputDirectory !== undefined &&
    outputDirectory !== '' &&
    !options.force
  ) {
    const targetDirectory = resolve(cwd, outputDirectory)
    if (await pathExists(targetDirectory)) {
      return { status: 'skipped', targetDirectory }
    }
  }
  const globalConfigPath = dependencies.globalConfigPath ?? defaultConfigPath()
  const shouldLoadIndexes =
    options.index !== undefined || options.loadGlobalIndex !== false
  if (shouldLoadIndexes) {
    const globalConfig = await loadConfigDocument(globalConfigPath)
    if (globalConfig !== undefined || options.index !== undefined) {
      try {
        index = await loadIndexes(options.index, {
          configPath: globalConfigPath,
          fetch: request,
          getGithubToken: findToken,
          loadIndex: getIndex,
        })
      } catch (error) {
        if (
          !canRunWithoutIndex ||
          (error instanceof Error &&
            !error.message.startsWith('No indexes are configured') &&
            !(error instanceof IndexNotFoundError))
        ) {
          throw error
        }
      }
    }
  }

  const resolved = resolveAddOptions(
    source.slug,
    index?.repos[source.slug],
    { include: options.include, exclude: options.exclude, outputDirectory },
    index !== undefined,
  )
  const { include, exclude } = resolved
  outputDirectory = resolved.outputDirectory
  const targetDirectory = resolve(cwd, outputDirectory)
  const targetExists = await pathExists(targetDirectory)
  if (targetExists && !options.force) {
    return { status: 'skipped', targetDirectory }
  }

  const repoSlug = `${source.owner}/${source.repo}`
  const token = await findToken(repoSlug)
  const api = createGithubApi(request, token)
  const commit = source.commit
    ? await verifyCommit(api, source, source.commit)
    : await latestCommit(api, source)
  const paths = await listFiles(api, source, commit)
  const files = selectFiles(paths, include, exclude)

  if (files.length === 0) return { status: 'no-files', targetDirectory }

  const targetEntry = await lstatIfExists(targetDirectory)
  if (targetEntry?.isSymbolicLink()) await unlink(targetDirectory)
  await mkdir(targetDirectory, { recursive: true })
  for (const path of files) {
    const destination = resolve(targetDirectory, path)
    if (
      destination === targetDirectory ||
      !destination.startsWith(
        `${targetDirectory}${process.platform === 'win32' ? '\\' : '/'}`,
      )
    ) {
      throw new Error(`GitHub returned an unsafe path: ${path}`)
    }
    const sourcePath = source.path ? `${source.path}/${path}` : path
    const contents = await api(
      `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/contents/${encodePath(sourcePath)}?ref=${encodeURIComponent(commit)}`,
      'application/vnd.github.raw+json',
    )
    await prepareDestination(targetDirectory, path)
    await Bun.write(destination, await contents.arrayBuffer())
  }

  if (options.record !== false) {
    const configPath = resolve(cwd, options.config ?? 'ghd.config.yaml')
    await updateLocalConfig(configPath, source.slug, {
      include,
      exclude,
      outputDirectory,
      commit,
    })
    await updateGitignore(cwd, relative(cwd, targetDirectory))
  }

  return { status: 'downloaded', targetDirectory, commit, files }
}

function createGithubApi(request: typeof fetch, token: string) {
  return async (path: string, accept = 'application/vnd.github+json') => {
    const response = await request(`${API_ROOT}${path}`, {
      headers: {
        Accept: accept,
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': API_VERSION,
      },
    })
    if (!response.ok) {
      throw new Error(
        `GitHub API request failed (HTTP ${response.status}): ${path}`,
      )
    }
    return response
  }
}

async function verifyCommit(
  api: ReturnType<typeof createGithubApi>,
  source: ParsedRepository,
  requested: string,
): Promise<string> {
  const base = `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`
  for (const kind of ['heads', 'tags']) {
    const response = await apiOptional(
      api,
      `${base}/git/ref/${kind}/${encodeURIComponent(requested)}`,
    )
    if (response?.ok) {
      throw new Error(
        `Invalid commit SHA '${requested}'. Tags and branches are not allowed.`,
      )
    }
  }

  const response = await api(`${base}/commits/${encodeURIComponent(requested)}`)
  const value: unknown = await response.json()
  const sha = getString(value, 'sha')
  if (!sha.toLowerCase().startsWith(requested.toLowerCase())) {
    throw new Error(
      `Invalid commit SHA '${requested}'. Tags and branches are not allowed.`,
    )
  }
  return sha
}

async function apiOptional(
  api: ReturnType<typeof createGithubApi>,
  path: string,
): Promise<Response | undefined> {
  try {
    return await api(path)
  } catch (error) {
    if (error instanceof Error && error.message.includes('(HTTP 404)'))
      return undefined
    throw error
  }
}

async function latestCommit(
  api: ReturnType<typeof createGithubApi>,
  source: ParsedRepository,
): Promise<string> {
  const base = `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`
  const repository: unknown = await (await api(base)).json()
  const branch = getString(repository, 'default_branch')
  const commit: unknown = await (
    await api(`${base}/commits/${encodeURIComponent(branch)}`)
  ).json()
  return getString(commit, 'sha')
}

async function listFiles(
  api: ReturnType<typeof createGithubApi>,
  source: ParsedRepository,
  commit: string,
): Promise<string[]> {
  const base = `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/git/trees`
  const response = await api(
    `${base}/${encodeURIComponent(commit)}?recursive=1`,
  )
  const value: unknown = await response.json()
  if (!isRecord(value) || !Array.isArray(value.tree)) {
    throw new Error('GitHub returned an invalid repository tree.')
  }

  if (value.truncated === true) {
    const paths: string[] = []
    await collectTree(api, base, commit, '', source.path, paths)
    return paths
  }

  const prefix = source.path ? `${source.path}/` : ''
  return treeEntries(value).flatMap((entry) => {
    if (entry.type !== 'blob' || typeof entry.path !== 'string') return []
    if (!entry.path.startsWith(prefix)) return []
    const path = entry.path.slice(prefix.length)
    return path ? [path] : []
  })
}

async function collectTree(
  api: ReturnType<typeof createGithubApi>,
  base: string,
  treeSha: string,
  parent: string,
  sourcePath: string,
  paths: string[],
): Promise<void> {
  const value: unknown = await (
    await api(`${base}/${encodeURIComponent(treeSha)}`)
  ).json()
  if (!isRecord(value) || !Array.isArray(value.tree)) {
    throw new Error('GitHub returned an invalid repository tree.')
  }

  for (const entry of treeEntries(value)) {
    if (typeof entry.path !== 'string') continue
    const fullPath = parent ? `${parent}/${entry.path}` : entry.path
    if (entry.type === 'blob') {
      const prefix = sourcePath ? `${sourcePath}/` : ''
      if (fullPath.startsWith(prefix)) paths.push(fullPath.slice(prefix.length))
      continue
    }
    if (entry.type !== 'tree' || !treeCanContain(fullPath, sourcePath)) continue
    if (typeof entry.sha !== 'string') {
      throw new Error('GitHub returned an invalid repository tree.')
    }
    await collectTree(api, base, entry.sha, fullPath, sourcePath, paths)
  }
}

function treeCanContain(treePath: string, sourcePath: string): boolean {
  return (
    sourcePath === '' ||
    treePath === sourcePath ||
    sourcePath.startsWith(`${treePath}/`) ||
    treePath.startsWith(`${sourcePath}/`)
  )
}

function treeEntries(value: Record<string, unknown>): GithubTreeEntry[] {
  return value.tree as GithubTreeEntry[]
}

async function updateLocalConfig(
  configPath: string,
  slug: string,
  entry: LocalConfig['repos'][string],
): Promise<void> {
  let config: LocalConfig = { repos: {} }
  const file = Bun.file(configPath)
  if (await file.exists()) {
    config = normalizeLocalConfig(Bun.YAML.parse(await file.text()))
  }
  config.repos[slug] = entry
  await mkdir(dirname(configPath), { recursive: true })
  await Bun.write(configPath, Bun.YAML.stringify(config, null, 2))
}

export function normalizeLocalConfig(value: unknown): LocalConfig {
  const config: LocalConfig = { repos: {} }
  if (!isRecord(value) || !isRecord(value.repos)) return config

  for (const [slug, entry] of Object.entries(value.repos)) {
    if (
      !isRecord(entry) ||
      !isStringArray(entry.include) ||
      !isStringArray(entry.exclude) ||
      typeof entry.outputDirectory !== 'string' ||
      typeof entry.commit !== 'string'
    ) {
      continue
    }
    config.repos[slug] = {
      include: entry.include,
      exclude: entry.exclude,
      outputDirectory: entry.outputDirectory,
      commit: entry.commit,
    }
  }
  return config
}

async function updateGitignore(cwd: string, target: string): Promise<void> {
  const path = join(cwd, '.gitignore')
  const file = Bun.file(path)
  if (!(await file.exists())) return

  const entry = target.replaceAll('\\', '/')
  const contents = await file.text()
  const entries = contents.split(/\r?\n/)
  if (entries.includes(entry) || entries.includes(`./${entry}`)) return
  const separator = contents.length === 0 || contents.endsWith('\n') ? '' : '\n'
  await Bun.write(path, `${contents}${separator}${entry}\n`)
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

async function prepareDestination(
  targetDirectory: string,
  path: string,
): Promise<void> {
  const parts =
    process.platform === 'win32' ? path.split(/[\\/]/) : path.split('/')
  let parent = targetDirectory
  for (const part of parts.slice(0, -1)) {
    parent = resolve(parent, part)
    const entry = await lstatIfExists(parent)
    if (entry !== undefined && !entry.isDirectory()) await unlink(parent)
    await mkdir(parent, { recursive: true })
  }

  const destination = resolve(targetDirectory, path)
  const entry = await lstatIfExists(destination)
  if (entry?.isDirectory()) {
    await rm(destination, { recursive: true, force: true })
  } else if (entry !== undefined) {
    await unlink(destination)
  }
}

async function lstatIfExists(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return undefined
    throw error
  }
}

async function pathExists(path: string): Promise<boolean> {
  return (await lstatIfExists(path)) !== undefined
}

function getString(value: unknown, key: string): string {
  if (!isRecord(value) || typeof value[key] !== 'string') {
    throw new Error(`GitHub returned an invalid ${key}.`)
  }
  return value[key]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}