import { createCommand } from '@d-dev/roar'
import { type DataReader } from '../../DataManager'
import {
  DefaultIndexManager,
  type Index,
  type LoadRemoteIndexDependencies,
  loadRemoteIndex,
} from '../../index/index'
import { UserConfig, UserConfigPath } from '../../userConfig'

export interface AddIndexDependencies extends LoadRemoteIndexDependencies {
  configPath?: string
}

export const addIndexCmd = createCommand(
  {
    usageName: 'ghd indexes add <OWNER/REPO/path/to/index.yaml>',
    description: 'Validate and add an index',
  },
  async (args) => {
    if (args.input.length !== 1) {
      throw new Error(
        'The indexes add command requires one index in the format OWNER/REPO/path/to/index.yaml.',
      )
    }

    const index = args.input[0]
    if (index === undefined) return

    await addIndex(index)
    console.log(`Index ${index} added.`)
  },
)

export async function addIndex(
  index: string,
  dependencies: AddIndexDependencies = {},
): Promise<void> {
  const loadIndex = loadRemoteIndex
  class ConfiguredIndexReader implements DataReader<Index> {
    #index: string

    constructor(indexSlug: string) {
      this.#index = indexSlug
    }

    read(): Promise<Index> {
      return loadIndex(this.#index, dependencies)
    }
  }
  const manager = new DefaultIndexManager([index], ConfiguredIndexReader)
  for await (const _record of manager.records()) {
    // Iteration validates the complete index before it is configured.
  }

  const configPath = dependencies.configPath ?? UserConfigPath
  const file = new UserConfig(configPath)
  const config = await file.read()
  if (!config.indexes.includes(index)) {
    config.indexes.push(index)
    await file.save()
  }
}