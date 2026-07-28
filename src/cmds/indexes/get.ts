import { createCommand } from '@d-dev/roar'
import { configuredIndex, UserConfig, UserConfigPath } from '../../userConfig'

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
  configPath: string = UserConfigPath,
): Promise<string> {
  if (!(await Bun.file(configPath).exists())) {
    throw new Error(`Configuration file not found at ${configPath}.`)
  }
  const config = await new UserConfig(configPath).read()
  return configuredIndex(config, name, configPath)
}