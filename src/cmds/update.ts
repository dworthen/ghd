import { createCommand } from '@d-dev/roar'
import {
  loadConfig,
  saveConfig,
  selectReposForUpdate,
  updateGitignore,
} from '../config'
import { downloadFiles } from '../utils/github'

const LOCAL_CONFIG_PATH = '.ghd.config.yaml'

export const updateCmd = createCommand(
  {
    usageName: 'ghd update [repo_path...]',
    description:
      'Redownload configured repositories at their latest commit, updating the config',
    flags: {
      config: {
        type: 'string',
        shortFlag: 'c',
        description:
          'Specify a custom configuration file to use for the repositories.',
        isRequired: false,
        default: LOCAL_CONFIG_PATH,
      },
    },
  },
  async (args) => {
    const configPath = args.flags.config

    if (configPath.startsWith('gh:')) {
      console.error(
        'The update command can only operate on a local configuration file, not a remote (gh:) config.',
      )
      process.exit(1)
    }

    const config = await loadConfig(configPath, true)

    const targets = args.input.filter((target) => target.trim() !== '')
    const selection = selectReposForUpdate(config, targets)

    if (!selection.ok) {
      console.error(
        `The following repositories were not found in ${configPath}: ${selection.missing.join(', ')}`,
      )
      process.exit(1)
    }

    if (selection.repos.length === 0) {
      console.log(`No repositories to update in ${configPath}.`)
      return
    }

    try {
      for (const repo of selection.repos) {
        console.log(
          `Updating repository: ${repo.repoDirectory} to ${repo.outputDirectory}`,
        )
        const { commit } = await downloadFiles(
          repo.repoDirectory,
          repo.include,
          repo.exclude,
          repo.outputDirectory,
        )
        repo.commit = commit
        await updateGitignore(repo.outputDirectory)
      }
    } finally {
      await saveConfig(config, configPath)
    }
  },
)