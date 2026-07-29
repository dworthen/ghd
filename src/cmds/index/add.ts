import { createCommand } from '@d-dev/roar'
import { type LoadRemoteIndexDependencies } from '../../index/index'
import { UserConfig } from '../../userConfig'

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
    if (index === undefined) {
      console.error(
        'The index add command requires one positional argument, the index.',
      )
      args.showHelp()
      return
    }

    const userConfigFile = new UserConfig()
    const userConfig = await userConfigFile.read()
    if (!userConfig.indexes.includes(index)) {
      userConfig.indexes.push(index)
      await userConfigFile.save()
    }
    console.log(`Index ${index} added.`)
  },
)