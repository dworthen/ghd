import { createCommand } from '@d-dev/roar'
import { loadConfig, updateGitignore } from '../config'
import { downloadFiles } from '../utils/github'

export const installCmd = createCommand(
  {
    usageName: 'ghd install [config=.ghd.config.yaml]',
    description: 'Download every repository in a local configuration',
    flags: {
      force: {
        type: 'boolean',
        shortFlag: 'f',
        description:
          'Force download even if the target directory already exists',
        isRequired: false,
        default: false,
      },
    },
  },
  async (args) => {
    const configPath = args.input[0] ?? '.ghd.config.yaml'

    const config = await loadConfig(configPath, true)

    for (const repo of config.repos) {
      const repoPath = [repo.repoDirectory, repo.commit].join('@')

      console.log(
        `Downloading files for repository: ${repoPath} to ${repo.outputDirectory}`,
      )
      await downloadFiles(
        repoPath,
        repo.include,
        repo.exclude,
        repo.outputDirectory,
        args.flags.force,
      )
      await updateGitignore(repo.outputDirectory)
    }
  },
)