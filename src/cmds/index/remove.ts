import { createCommand } from '@d-dev/roar'
import { UserConfig } from '../../userConfig'

export interface RemoveIndexDependencies {
  configPath?: string
}

export const removeIndexCmd = createCommand(
  {
    usageName: 'ghd index remove <index>',
    description: 'Remove a configured index',
  },
  async (args) => {
    if (args.input.length !== 1) {
      throw new Error('The index remove command requires one index.')
    }

    const index = args.input[0]
    if (index == null || index.trim() === '') {
      console.error(
        'The index remove command requires one positional argument, the index.',
      )
      args.showHelp()
      return
    }

    const file = new UserConfig()
    const config = await file.read()
    const position = config.indexes.indexOf(index)
    if (position === -1) return

    config.indexes.splice(position, 1)
    await file.save()
    console.log(`Index ${index} removed.`)
  },
)