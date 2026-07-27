import { createCommand } from '@d-dev/roar'
import { add } from '../add'

const command = createCommand(
  {
    usageName: 'ghd add <OWNER/REPO[/path][@COMMIT_SHA]>',
    description: 'Download matching files from a GitHub repository directory',
    flags: {
      outputDirectory: {
        type: 'string',
        shortFlag: 'o',
        description: 'Directory where matching files are downloaded',
      },
      include: {
        type: 'string',
        shortFlag: 'i',
        description: 'File or glob to include (repeatable)',
        isMultiple: true,
      },
      exclude: {
        type: 'string',
        shortFlag: 'e',
        description: 'File or glob to exclude (repeatable)',
        isMultiple: true,
      },
      index: {
        type: 'string',
        description: 'Configured index name to load (repeatable)',
        isMultiple: true,
      },
      config: {
        type: 'string',
        shortFlag: 'c',
        description:
          'Local configuration path relative to the current directory',
        default: 'ghd.config.yaml',
      },
      force: {
        type: 'boolean',
        shortFlag: 'f',
        description:
          'Overwrite downloaded files in an existing target directory',
        default: false,
      },
    },
  },
  async (args) => {
    if (args.input.length !== 1) {
      throw new Error('The add command requires one repository.')
    }
    const repository = args.input[0]
    if (repository === undefined) return

    const result = await add(repository, args.flags.outputDirectory, {
      ...args.flags,
      include: args.flags.include?.length ? args.flags.include : undefined,
      exclude: args.flags.exclude?.length ? args.flags.exclude : undefined,
      index: args.flags.index?.length ? args.flags.index : undefined,
    })
    if (result.status === 'skipped') {
      console.log(
        `${result.targetDirectory} already exists. Use --force to overwrite files in it.`,
      )
      return
    }
    if (result.status === 'no-files') {
      console.log(
        `No files found at ${repository} that match the include criteria.`,
      )
      return
    }
    console.log(
      `Downloaded ${result.files.length} file(s) to ${result.targetDirectory}.`,
    )
  },
)

const help = `
  Download matching files from a GitHub repository directory

  Usage
    ghd add <OWNER/REPO[/path][@COMMIT_SHA]> [options]

  Options
    --output-directory, -o    Directory where matching files are downloaded
    --include, -i             File or glob to include (repeatable)
    --exclude, -e             File or glob to exclude (repeatable)
    --index                   Configured index name to load (repeatable)
    --config, -c              Local configuration path relative to the current directory [ghd.config.yaml]
    --force, -f               Overwrite downloaded files in an existing target directory
`

export const addCmd = {
  description: command.description,
  addCommand: command.addCommand.bind(command),
  async run(args: string[]) {
    if (args.includes('--help') || args.includes('-h')) {
      console.log(help)
      return
    }
    await command.run(args)
  },
}