import { downloadFiles, getFileContents, parseRepoPath } from './utils/github'
import { isRecord } from './utils/records'
import { resolvePath } from './utils/resolvePath'

export type RepoConfig = {
  repoDirectory: string
  commit: string
  include: string[]
  exclude: string[]
  outputDirectory: string
}

export type GhdConfig = {
  repos: RepoConfig[]
}

const DEFAULT_CONFIG: GhdConfig = {
  repos: [],
}

function isConfig(value: unknown): value is GhdConfig {
  if (!isRecord(value)) return false
  if (!Array.isArray(value.repos)) return false
  for (const repo of value.repos) {
    if (!isRecord(repo)) return false
    if (
      typeof repo.repoDirectory !== 'string' ||
      repo.repoDirectory.trim() === ''
    )
      return false
    if (typeof repo.commit !== 'string' || repo.commit.trim() === '')
      return false
    if (!Array.isArray(repo.include)) return false
    if (
      repo.include.some(
        (item) => typeof item !== 'string' || item.trim() === '',
      )
    )
      return false
    if (!Array.isArray(repo.exclude)) return false
    if (
      repo.exclude.some(
        (item) => typeof item !== 'string' || item.trim() === '',
      )
    )
      return false
    if (typeof repo.outputDirectory !== 'string') return false
  }
  return true
}

export function validateConfig(
  configPath: string,
  value: unknown,
): asserts value is GhdConfig {
  const valid = isConfig(value)
  if (!valid) {
    throw new Error(`Invalid configuration: ${configPath}`)
  }
}

async function loadConfigFromGithub(configPath: string): Promise<GhdConfig> {
  const repoPath = configPath.slice(3)
  const { owner, repo, path, token } = await parseRepoPath(repoPath)
  const fileContents = await getFileContents(owner, repo, path, token)
  const base64Contents = fileContents.content.replace(/\s+/g, '')
  const bytes = Uint8Array.fromBase64(base64Contents)
  const contentsString = new TextDecoder().decode(bytes)
  const config = Bun.YAML.parse(contentsString)
  validateConfig(configPath, config)
  return config
}

export async function loadConfigFromPath(
  configPath: string,
  required: boolean = false,
): Promise<GhdConfig> {
  configPath = resolvePath(configPath)
  const file = Bun.file(configPath)
  if (!(await file.exists())) {
    if (required) {
      throw new Error(`Configuration file not found: ${configPath}`)
    }

    return DEFAULT_CONFIG
  }
  const content = await file.text()
  const config = Bun.YAML.parse(content)
  validateConfig(configPath, config)
  return config
}

export async function loadConfig(
  configPath: string,
  required: boolean = false,
): Promise<GhdConfig> {
  if (configPath.startsWith('gh:')) {
    return await loadConfigFromGithub(configPath)
  } else {
    return await loadConfigFromPath(configPath, required)
  }
}

export async function saveConfig(config: any, path: string): Promise<void> {
  const file = Bun.file(resolvePath(path))
  const content = Bun.YAML.stringify(config, null, 2)
  await Bun.write(file, content)
}

export function mergeConfig(
  localConfig: GhdConfig,
  remoteConfig: GhdConfig,
): GhdConfig {
  const merged: GhdConfig = {
    ...localConfig,
    repos: localConfig.repos.map((repo) => ({ ...repo })),
  }
  for (const repo of remoteConfig.repos) {
    addRepoToConfig(merged, { ...repo })
  }
  return merged
}

export function addRepoToConfig(
  localConfig: GhdConfig,
  repo: RepoConfig,
): void {
  const ind = localConfig.repos.findIndex(
    (r) => r.repoDirectory === repo.repoDirectory,
  )

  if (ind === -1) {
    localConfig.repos.push(repo)
  } else {
    localConfig.repos[ind] = repo
  }
}

export type SelectReposForUpdateResult =
  | { ok: true; repos: RepoConfig[] }
  | { ok: false; missing: string[] }

export function selectReposForUpdate(
  config: GhdConfig,
  targets: string[],
): SelectReposForUpdateResult {
  if (targets.length === 0) {
    return { ok: true, repos: config.repos }
  }

  const matched: RepoConfig[] = []
  const missing: string[] = []
  for (const target of targets) {
    const found = config.repos.find((repo) => repo.repoDirectory === target)
    if (found) {
      matched.push(found)
    } else {
      missing.push(target)
    }
  }

  if (missing.length > 0) {
    return { ok: false, missing }
  }
  return { ok: true, repos: matched }
}

type DownloadFiles = (
  repoPath: string,
  include: string[],
  exclude: string[],
  targetDirectory: string,
) => Promise<{ commit: string }>

export type UpdateReposOptions = {
  download?: DownloadFiles
  updateGitignore?: (target: string) => Promise<void>
  saveConfig?: (config: GhdConfig, path: string) => Promise<void>
}

export type UpdateReposResult =
  | { ok: true; updated: RepoConfig[] }
  | { ok: false; missing: string[] }

export async function updateRepos(
  config: GhdConfig,
  configPath: string,
  targets: string[],
  {
    download = downloadFiles,
    updateGitignore: gitignore = updateGitignore,
    saveConfig: save = saveConfig,
  }: UpdateReposOptions = {},
): Promise<UpdateReposResult> {
  const selection = selectReposForUpdate(config, targets)
  if (!selection.ok) {
    return selection
  }

  const updated: RepoConfig[] = []
  if (selection.repos.length === 0) {
    return { ok: true, updated }
  }

  try {
    for (const repo of selection.repos) {
      console.log(
        `Updating repository: ${repo.repoDirectory} to ${repo.outputDirectory}`,
      )
      const { commit } = await download(
        repo.repoDirectory,
        repo.include,
        repo.exclude,
        repo.outputDirectory,
      )
      repo.commit = commit
      await gitignore(repo.outputDirectory)
      updated.push(repo)
    }
  } finally {
    await save(config, configPath)
  }

  return { ok: true, updated }
}

export async function updateGitignore(target: string): Promise<void> {
  const path = resolvePath('.gitignore')
  const file = Bun.file(path)
  const contents = (await file.exists()) ? await file.text() : ''

  const hasCr = contents.match(/\r/)
  const hasLf = contents.match(/\n/)
  const hasCrLf = hasCr && hasLf

  const separator = hasCrLf ? '\r\n' : hasCr ? '\r' : '\n'

  const entry = target.replaceAll('\\', '/')
  const entries = contents.split(separator)

  if (entries.includes(entry) || entries.includes(`./${entry}`)) return
  const nl =
    contents.length === 0 || contents.endsWith(separator) ? '' : separator
  await Bun.write(
    path,
    `${contents}${nl}# Added by ghd cli.${separator}${entry}`,
  )
}