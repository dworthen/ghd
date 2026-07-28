import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const ConfigDirectory =
  process.env.GHD_CONFIG_DIRECTORY ?? join(homedir(), '.ghd')

export type Config = {
  indexes: Record<string, string>
}

export type ConfigDocument = Record<string, unknown>

export function defaultConfigPath(): string {
  return join(ConfigDirectory, 'ghd.config.yaml')
}

export function isConfig(value: unknown): value is Config {
  return isRecord(value) && isStringRecord(value.indexes)
}

export function validateConfig(
  value: ConfigDocument,
  configPath: string,
): Config & ConfigDocument {
  const indexes = configuredIndexes(value, configPath)
  if (isConfig(value)) return value

  return { ...value, indexes }
}

export function parseConfig(
  contents: string,
  configPath: string,
): Config & ConfigDocument {
  const loaded: unknown = Bun.YAML.parse(contents)
  if (!isRecord(loaded)) {
    throw new Error(`No indexes are configured in ${configPath}.`)
  }

  return validateConfig(loaded, configPath)
}

export function parseConfigDocument(
  contents: string,
  configPath: string,
): ConfigDocument {
  const loaded: unknown = Bun.YAML.parse(contents)

  if (loaded === null) return {}
  if (!isRecord(loaded)) {
    throw new Error(
      `Configuration file at ${configPath} is not a YAML mapping.`,
    )
  }

  return loaded
}

export async function loadConfig(
  configPath: string = defaultConfigPath(),
): Promise<(Config & ConfigDocument) | undefined> {
  const file = Bun.file(configPath)
  if (!(await file.exists())) return undefined

  return parseConfig(await file.text(), configPath)
}

export async function loadConfigDocument(
  configPath: string = defaultConfigPath(),
): Promise<ConfigDocument | undefined> {
  const file = Bun.file(configPath)
  if (!(await file.exists())) return undefined

  return parseConfigDocument(await file.text(), configPath)
}

export async function saveConfig(
  config: Config & ConfigDocument,
  configPath: string = defaultConfigPath(),
): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true })
  await Bun.write(configPath, Bun.YAML.stringify(config, null, 2))
}

export function withConfiguredIndex(
  config: ConfigDocument,
  name: string,
  index: string,
): Config & ConfigDocument {
  const existing = isStringRecord(config.indexes) ? config.indexes : {}
  return { ...config, indexes: { ...existing, [name]: index } }
}

export function configuredIndexes(
  config: ConfigDocument,
  configPath: string,
): Record<string, string> {
  if (!isStringRecord(config.indexes)) {
    throw new Error(`No indexes are configured in ${configPath}.`)
  }

  return config.indexes
}

export function configuredIndex(
  config: ConfigDocument,
  name: string,
  configPath: string,
): string {
  const indexes = configuredIndexes(config, configPath)
  const index = Object.hasOwn(indexes, name) ? indexes[name] : undefined
  if (index === undefined) {
    throw new Error(`Index '${name}' is not configured in ${configPath}.`)
  }
  return index
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isPlainRecord(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  )
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}