import { createCommand } from '@d-dev/roar'

export const helloCmd = createCommand(
  {
    usageName: 'ghd hello',
    description: 'Prints Hello, World! to the console',
    flags: {
      name: {
        type: 'string',
        shortFlag: 'n',
        description: 'Your name',
        isRequired: true,
      },
    },
  },
  async (args) => {
    const name = args.flags.name
    console.log(`Hello, ${name}!`)
  },
)