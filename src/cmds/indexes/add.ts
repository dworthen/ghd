import { createCommand } from '@d-dev/roar'
import {
  type LoadRemoteIndexDependencies,
  loadRemoteIndex,
} from '../../indexes'
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
  await loadRemoteIndex(index, dependencies)

  const configPath = dependencies.configPath ?? UserConfigPath
  const file = new UserConfig(configPath)
  const config = await file.read()
  if (!config.indexes.includes(index)) {
    config.indexes.push(index)
    await file.save()
  }
}