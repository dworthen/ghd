import { createCommand } from '@d-dev/roar'
import { UserConfig } from '../../userConfig'

export type ListFormat = 'json' | 'yaml'

export const listIndexesCmd = createCommand(
  {
    usageName: 'ghd index list',
    description: 'Print configured indexes',
    flags: {
      format: {
        type: 'string',
        shortFlag: 'f',
        choices: ['json', 'yaml'],
        default: 'json',
        description: 'Output format',
      },
    },
  },
  async (args) => {
    const config = await new UserConfig().read()
    if (config.indexes.length === 0) {
      console.log('No indexes configured.')
      return
    }
    console.log(
      args.flags.format === 'yaml'
        ? Bun.YAML.stringify(config.indexes, null, 2)
        : JSON.stringify(config.indexes, null, 2),
    )
  },
)