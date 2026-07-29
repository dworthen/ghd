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
  InvalidFileExtensionError,
  ValidationError,
} from '../errors'
import { UserConfigPath } from '../paths'
import { isPlainRecord } from '../utils/parsing'

export type UserConfigDocument = {
  indexes: string[]
}

export function isUserConfigDocument(
  value: unknown,
): value is UserConfigDocument {
  return (
    isPlainRecord(value) &&
    Array.isArray(value.indexes) &&
    value.indexes.every((index) => typeof index === 'string') &&
    new Set(value.indexes).size === value.indexes.length
  )
}

export class UserConfig
  implements DataReader<UserConfigDocument>, DataWriter, DataValidator
{
  #configPath: string
  #config: UserConfigDocument | null = null

  constructor(configPath: string = UserConfigPath) {
    this.#configPath = resolve(configPath)
    if (
      !this.#configPath.endsWith('.yml') &&
      !this.#configPath.endsWith('.yaml')
    ) {
      throw new InvalidFileExtensionError(
        `User configuration path must end with .yml or .yaml: ${this.#configPath}`,
      )
    }
  }

  async read(): Promise<UserConfigDocument> {
    if (this.#config !== null) return this.#config

    const file = Bun.file(this.#configPath)
    if (!(await file.exists())) {
      this.#config = { indexes: [] }
      return this.#config
    }

    const contents = await file.text()
    if (contents.trim() === '') {
      this.#config = { indexes: [] }
      return this.#config
    }

    let parsed: unknown
    try {
      parsed = Bun.YAML.parse(contents)
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : ''
      throw new ValidationError(
        `User configuration at ${this.#configPath} is not valid YAML${detail}`,
      )
    }

    this.#config = parsed as UserConfigDocument
    try {
      await this.validate()
    } catch (error) {
      this.#config = null
      throw error
    }
    return this.#config
  }

  async validate(): Promise<void> {
    if (this.#config === null) {
      throw new ValidationError(
        `User configuration at ${this.#configPath} has not been loaded.`,
      )
    }
    if (!isPlainRecord(this.#config)) {
      throw new ValidationError(
        `Configuration file at ${this.#configPath} is not a YAML mapping.`,
      )
    }
    if (!isUserConfigDocument(this.#config)) {
      throw new ValidationError(
        `No indexes are configured in ${this.#configPath}. Expected indexes to be a unique list of strings.`,
      )
    }
  }

  async save(
    throwIfExists: boolean = false,
    saveEmpty: boolean = false,
  ): Promise<void> {
    const file = Bun.file(this.#configPath)
    if (throwIfExists && (await file.exists())) {
      throw new FileAlreadyExistsError(
        `User configuration already exists at ${this.#configPath}.`,
      )
    }

    if (this.#config === null && !saveEmpty) {
      throw new FileNotLoadedError(
        `User configuration at ${this.#configPath} has not been loaded.`,
      )
    }

    await mkdir(dirname(this.#configPath), { recursive: true })
    if (this.#config === null) {
      await Bun.write(this.#configPath, '')
      return
    }

    await this.validate()
    await Bun.write(this.#configPath, Bun.YAML.stringify(this.#config, null, 2))
  }
}