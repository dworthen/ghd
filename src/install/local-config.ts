import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export type LocalConfigEntry = {
  include: string[]
  exclude: string[]
  outputDirectory: string
  commit: string
}

export type LocalConfig = Record<string, unknown> & {
  repos: Record<string, LocalConfigEntry>
}

export function parseLocalConfig(contents: string): LocalConfig {
  const value: unknown = Bun.YAML.parse(contents)
  if (!isRecord(value)) return { repos: {} }
  const config: LocalConfig = { ...value, repos: {} }
  if (!isRecord(value.repos)) return config

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

export async function loadLocalConfig(path: string): Promise<LocalConfig> {
  return parseLocalConfig(await Bun.file(path).text())
}

export async function saveLocalConfig(
  config: LocalConfig,
  path: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, Bun.YAML.stringify(config, null, 2))
}

export function mergeLocalConfigs(
  local: LocalConfig,
  remote: LocalConfig,
): LocalConfig {
  return {
    ...local,
    ...remote,
    repos: { ...local.repos, ...remote.repos },
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}