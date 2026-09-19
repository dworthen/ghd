import { createCommand } from '@d-dev/roar'
import pkg from '../package.json'
import { deleteCmd } from './cmds/delete'
import { installCmd } from './cmds/install'
import { pullCmd } from './cmds/pull'
import { pushCmd } from './cmds/push'
import { cleanupStaleUpgrade, upgradeCmd } from './cmds/upgrade'

const cli = createCommand({
  usageName: 'ghd',
  description: pkg.description,
  version: pkg.version,
  versionFlag: 'version',
})

cli.addCommand('pull', pullCmd)
cli.addCommand('push', pushCmd)
cli.addCommand('install', installCmd)
cli.addCommand('delete', deleteCmd)
cli.addCommand('upgrade', upgradeCmd)

try {
  await cleanupStaleUpgrade()
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