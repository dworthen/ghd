import { createCommand } from '@d-dev/roar'
import { DefaultIndexManager } from '../../index/index'
import { UserConfig } from '../../userConfig'
import { DefaultCollectionDownloader } from '../../workers/collectionDownloader/collectionDownloader'

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

    // const indexManager = new DefaultIndexManager([index])
    // await new DefaultCollectionDownloader(indexManager).download()
    console.log(`Index ${index} added.`)
  },
)