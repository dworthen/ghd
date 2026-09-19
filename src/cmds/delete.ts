import { createCommand } from '@d-dev/roar'
import { deleteFiles } from '../utils/github'

export const deleteCmd = createCommand(
  {
    usageName: 'ghd delete <repo_slug>',
    description: 'Delete contents from GitHub repo directory',
    flags: {
      include: {
        type: 'string',
        shortFlag: 'i',
        description: 'Include only specified files',
        isMultiple: true,
        isRequired: false,
        default: [],
      },
      exclude: {
        type: 'string',
        shortFlag: 'e',
        description: 'Exclude specified files',
        isMultiple: true,
        isRequired: false,
        default: [],
      },
    },
  },
  async (args) => {
    const [repoPath] = args.input
    if (!repoPath || repoPath.trim() === '') {
      console.error(
        'The delete command requires a repository slug to be specified. ghd delete <repo_slug>',
      )
      process.exit(1)
    }

    await deleteFiles(repoPath, args.flags.include, args.flags.exclude)
  },
)