import { createCommand } from '@d-dev/roar'
import { defaultConfigPath, loadConfig } from '../../config'

export type ListFormat = 'json' | 'yaml'

export const listIndexesCmd = createCommand(
  {
    usageName: 'ghd indexes list',
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
  configPath: string = defaultConfigPath(),
): Promise<string> {
  const config = await loadConfig(configPath)
  if (config === undefined) {
    throw new Error(`Configuration file not found at ${configPath}.`)
  }

  return format === 'yaml'
    ? Bun.YAML.stringify(config.indexes, null, 2)
    : JSON.stringify(config.indexes, null, 2)
}