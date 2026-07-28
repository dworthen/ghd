import { createCommand } from '@d-dev/roar'
import { UserConfig, UserConfigPath } from '../../userConfig'

export interface RemoveIndexDependencies {
  configPath?: string
}

export const removeIndexCmd = createCommand(
  {
    usageName: 'ghd indexes remove <index>',
    description: 'Remove a configured index',
  },
  async (args) => {
    if (args.input.length !== 1) {
      throw new Error('The indexes remove command requires one index.')
    }

    const index = args.input[0]
    if (index === undefined) return

    await removeIndex(index)
    console.log(`Index ${index} removed.`)
  },
)

export async function removeIndex(
  index: string,
  dependencies: RemoveIndexDependencies = {},
): Promise<void> {
  const configPath = dependencies.configPath ?? UserConfigPath
  const file = new UserConfig(configPath)
  const config = await file.read()
  const position = config.indexes.indexOf(index)
  if (position === -1) return

  config.indexes.splice(position, 1)
  await file.save()
}