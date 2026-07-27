import { createCommand } from '@d-dev/roar'
import pkg from '../package.json'
import { addCmd } from './cmds/add'
import { helloCmd } from './cmds/hello'
import { indexesCmd } from './cmds/indexes'
import { installCmd } from './cmds/install'
import { upgradeCmd } from './cmds/upgrade'

const cli = createCommand({
  usageName: 'ghd',
  description: pkg.description,
  version: pkg.version,
  versionFlag: 'version',
})

cli.addCommand('add', addCmd)
cli.addCommand('hello', helloCmd)
cli.addCommand('install', installCmd)
cli.addCommand('indexes', indexesCmd)
cli.addCommand('upgrade', upgradeCmd)

try {
  await cli.run(process.argv.slice(2))
} catch (error: unknown) {
  // Graceful ctrl+c handling for inquirer
  if (error instanceof Error && error.name === 'ExitPromptError') {
    process.exit(0)
  }

  if (error instanceof Error) {
    console.error(`Error: ${error.message}`)
  } else {
    console.error('An unexpected error occurred.')
    console.error(error)
  }

  process.exit(1)
}