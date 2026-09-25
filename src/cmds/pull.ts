import { createCommand } from '@d-dev/roar'
import {
  addRepoToConfig,
  loadConfig,
  saveConfig,
  updateGitignore,
} from '../config'
import { downloadFiles, parseRepoPath } from '../utils/github'

export const pullCmd = createCommand(
  {
    usageName: 'ghd pull <repo_path> <output_directory>',
    description: 'Download contents from GitHub repo directory',
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
      save: {
        type: 'boolean',
        shortFlag: 's',
        description:
          'Save the repository configuration to the specified configuration file.',
        isRequired: false,
        default: false,
      },
      config: {
        type: 'string',
        shortFlag: 'c',
        description:
          'Specify a custom configuration file to use for the repository.',
        isRequired: true,
        default: '.ghd.config.yaml',
      },
    },
  },
  async (args) => {
    const [repoPath, outputDirectory] = args.input
    if (!repoPath || repoPath.trim() === '') {
      console.error(
        'The pull command requires one repository. ghd pull <repo_path> <output_directory>',
      )
      process.exit(1)
    }
    if (!outputDirectory || outputDirectory.trim() === '') {
      console.error(
        'The pull command requires an output directory to be specified. ghd pull <repo_path> <output_directory>',
      )
      process.exit(1)
    }
    const include = args.flags.include
    const exclude = args.flags.exclude
    const out = outputDirectory.replace(/\\/g, '/')

    await downloadFiles(repoPath, include, exclude, out)

    if (args.flags.save) {
      const { commit } = await parseRepoPath(repoPath)

      const localConfig = await loadConfig(args.flags.config)

      addRepoToConfig(localConfig, {
        repoDirectory: repoPath,
        commit,
        include,
        exclude,
        outputDirectory: out,
      })
      await saveConfig(localConfig, args.flags.config)
      await updateGitignore(out)
    }
  },
)