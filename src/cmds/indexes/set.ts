import { createCommand } from '@d-dev/roar'
import { type LoadRemoteIndexDependencies, loadIndexes } from '../../indexes'
import { UserConfig, UserConfigPath } from '../../userConfig'

export interface SetIndexDependencies extends LoadRemoteIndexDependencies {
  configPath?: string
}

export const setIndexCmd = createCommand(
  {
    usageName: 'ghd indexes set <name> <OWNER/REPO/path/to/index.yaml>',
    description: 'Validate and configure a named index',
  },
  async (args) => {
    if (args.input.length !== 2) {
      throw new Error(
        'The indexes set command requires an index name and an index in the format OWNER/REPO/path/to/index.yaml.',
      )
    }

    const [name, index] = args.input
    if (name === undefined || index === undefined) return

    await setIndex(name, index)
    console.log(`Index '${name}' set to ${index}.`)
  },
)

export async function setIndex(
  name: string,
  index: string,
  dependencies: SetIndexDependencies = {},
): Promise<void> {
  await loadIndexes([name], { ...dependencies, indexes: { [name]: index } })

  const configPath = dependencies.configPath ?? UserConfigPath
  const file = new UserConfig(configPath)
  const config = await file.load()
  config.indexes[name] = index
  await file.save()
}