import { createCommand } from '@d-dev/roar'
import { UserConfigPath } from '../../paths'
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
    console.log(await listIndexes(args.flags.format as ListFormat))
  },
)

export async function listIndexes(
  format: ListFormat = 'json',
  configPath: string = UserConfigPath,
): Promise<string> {
  if (!(await Bun.file(configPath).exists())) {
    throw new Error(`Configuration file not found at ${configPath}.`)
  }
  const config = await new UserConfig(configPath).read()
  return format === 'yaml'
    ? Bun.YAML.stringify(config.indexes, null, 2)
    : JSON.stringify(config.indexes, null, 2)
}