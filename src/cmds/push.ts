import { createCommand } from '@d-dev/roar'
import { uploadFiles } from '../utils/github'

export const pushCmd = createCommand(
  {
    usageName: 'ghd push <directory> <repo_slug>',
    description: 'Upload contents to GitHub repo directory',
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
    const [directory, repoPath] = args.input
    if (!directory || directory.trim() === '') {
      console.error(
        'The push command requires a directory to be specified. ghd push <directory> <repo_slug>',
      )
      process.exit(1)
    }
    if (!repoPath || repoPath.trim() === '') {
      console.error(
        'The push command requires a repository slug to be specified. ghd push <directory> <repo_slug>',
      )
      process.exit(1)
    }

    await uploadFiles(
      directory,
      repoPath,
      args.flags.include,
      args.flags.exclude,
    )
  },
)