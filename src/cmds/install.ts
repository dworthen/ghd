import { createCommand } from '@d-dev/roar'
import { install, installReport } from '../install'

export const installCmd = createCommand(
  {
    usageName: 'ghd install [local-config]',
    description: 'Download every repository in a local configuration',
    flags: {
      force: {
        type: 'boolean',
        shortFlag: 'f',
        description:
          'Download all configured repositories, even when targets exist',
        default: false,
      },
    },
  },
  async (args) => {
    if (args.input.length > 1) {
      throw new Error(
        'The install command accepts at most one configuration path.',
      )
    }
    const result = await install(args.input[0], { force: args.flags.force })
    for (const line of installReport(result)) console.log(line)
  },
)