import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { type AddResult, add } from '../add'
import { getGithubToken } from '../utils/github-token'
import {
  type LocalConfig,
  loadLocalConfig,
  mergeLocalConfigs,
  parseLocalConfig,
  saveLocalConfig,
} from './local-config'

const API_ROOT = 'https://api.github.com'
const API_VERSION = '2026-03-10'
const DEFAULT_CONFIG = 'ghd.config.yaml'

export type InstallOptions = {
  force?: boolean
  cwd?: string
}

export type InstallResult = {
  source: string
  results: InstallRepoResult[]
}

export type InstallRepoResult = {
  repository: string
  outputDirectory: string
  status: AddResult['status']
}

type Download = (
  repository: string,
  outputDirectory: string,
  options: {
    include: string[]
    exclude: string[]
    force: boolean
    cwd: string
    record: false
    loadGlobalIndex: false
  },
) => Promise<AddResult>

export interface InstallDependencies {
  download?: Download
  fetch?: typeof globalThis.fetch
  getGithubToken?: (repo: string) => Promise<string>
  globalConfigPath?: string
}

export async function install(
  source = DEFAULT_CONFIG,
  options: InstallOptions = {},
  dependencies: InstallDependencies = {},
): Promise<InstallResult> {
  const cwd = options.cwd ?? process.cwd()
  const remoteLocation = source.startsWith('gh:')
    ? parseRemoteConfigLocation(source.slice(3))
    : undefined
  const config = remoteLocation
    ? await loadRemoteLocalConfig(remoteLocation, dependencies)
    : await loadLocalConfig(resolve(cwd, source))
  const download =
    dependencies.download ??
    ((repository, outputDirectory, addOptions) =>
      add(repository, outputDirectory, addOptions, {
        fetch: dependencies.fetch,
        getGithubToken: dependencies.getGithubToken,
        globalConfigPath: dependencies.globalConfigPath,
      }))

  const results = await Promise.all(
    Object.entries(config.repos).map(async ([repository, entry]) => {
      const target = resolve(cwd, entry.outputDirectory)
      if (!options.force && (await isDirectory(target))) {
        return {
          repository,
          outputDirectory: entry.outputDirectory,
          status: 'skipped' as const,
        }
      }

      const pinnedRepository = entry.commit
        ? `${repository}@${entry.commit}`
        : repository
      const result = await download(pinnedRepository, entry.outputDirectory, {
        include: entry.include,
        exclude: entry.exclude,
        force: true,
        cwd,
        record: false,
        loadGlobalIndex: false,
      })
      return {
        repository,
        outputDirectory: entry.outputDirectory,
        status: result.status,
      }
    }),
  )

  if (remoteLocation) {
    const localPath = resolve(cwd, DEFAULT_CONFIG)
    const local = (await Bun.file(localPath).exists())
      ? await loadLocalConfig(localPath)
      : { repos: {} }
    await saveLocalConfig(mergeLocalConfigs(local, config), localPath)
  }

  return { source, results }
}

export function installReport(result: InstallResult): string[] {
  return result.results.map((entry) => {
    if (entry.status === 'downloaded') {
      return `Downloaded ${entry.repository} to ${entry.outputDirectory}.`
    }
    if (entry.status === 'skipped') {
      return `Skipped ${entry.repository}; ${entry.outputDirectory} already exists.`
    }
    return `No files downloaded for ${entry.repository} to ${entry.outputDirectory}.`
  })
}

export type RemoteConfigLocation = {
  repo: string
  path: string
}

export function parseRemoteConfigLocation(value: string): RemoteConfigLocation {
  const [owner, repo, ...pathParts] = value.split('/')
  if (
    !owner ||
    !repo ||
    pathParts.length === 0 ||
    pathParts.some((part) => !part) ||
    !pathParts.at(-1)?.endsWith('.yaml')
  ) {
    throw new Error(
      `Invalid remote config '${value}'. Expected OWNER/REPO/path/to/local/config.yaml.`,
    )
  }
  return { repo: `${owner}/${repo}`, path: pathParts.join('/') }
}

export async function loadRemoteLocalConfig(
  location: RemoteConfigLocation,
  dependencies: Pick<InstallDependencies, 'fetch' | 'getGithubToken'> = {},
): Promise<LocalConfig> {
  const request = dependencies.fetch ?? globalThis.fetch
  const findToken = dependencies.getGithubToken ?? getGithubToken
  const token = await findToken(location.repo)
  const [owner, repo] = location.repo.split('/')
  const path = location.path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  const response = await request(
    `${API_ROOT}/repos/${encodeURIComponent(owner ?? '')}/${encodeURIComponent(repo ?? '')}/contents/${path}`,
    {
      headers: {
        Accept: 'application/vnd.github.raw+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': API_VERSION,
      },
    },
  )
  if (!response.ok) {
    throw new Error(
      `Failed to get remote config ${location.repo}/${location.path} from GitHub (HTTP ${response.status}).`,
    )
  }
  return parseLocalConfig(await response.text())
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return false
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}