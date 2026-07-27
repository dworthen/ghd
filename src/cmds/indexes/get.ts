import { createCommand } from '@d-dev/roar'
import { configuredIndex, defaultConfigPath, loadConfig } from '../../config'

export const getIndexCmd = createCommand(
  {
    usageName: 'ghd indexes get <name>',
    description: 'Print a configured index',
  },
  async (args) => {
    if (args.input.length !== 1) {
      throw new Error('The indexes get command requires one index name.')
    }
    const name = args.input[0]
    if (name === undefined) return
    console.log(await readIndex(name))
  },
)

export async function readIndex(
  name: string,
  configPath: string = defaultConfigPath(),
): Promise<string> {
  const config = await loadConfig(configPath)
  if (config === undefined) {
    throw new Error(`Configuration file not found at ${configPath}.`)
  }

  return configuredIndex(config, name, configPath)
}