import { createCommand } from '@d-dev/roar'
import { type LoadRemoteIndexDependencies } from '../../index/index'
import { UserConfig, UserConfigPath } from '../../userConfig'

export interface AddIndexDependencies extends LoadRemoteIndexDependencies {
  configPath?: string
}

export const addIndexCmd = createCommand(
  {
    usageName: 'ghd index add <index>',
    description: 'Add an index',
  },
  async (args) => {
    if (args.input.length !== 1) {
      throw new Error('The index add command requires one index.')
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
  const configPath = dependencies.configPath ?? UserConfigPath
  const file = new UserConfig(configPath)
  const config = await file.read()
  if (!config.indexes.includes(index)) {
    config.indexes.push(index)
    await file.save()
  }
}