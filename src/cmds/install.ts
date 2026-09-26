import { createCommand } from '@d-dev/roar'
import { loadConfig, mergeConfig, saveConfig, updateGitignore } from '../config'
import { downloadFiles } from '../utils/github'

const LOCAL_CONFIG_PATH = '.ghd.config.yaml'

export const installCmd = createCommand(
  {
    usageName: 'ghd install [config=.ghd.config.yaml]',
    description: 'Download every repository in a local configuration',
  },
  async (args) => {
    const configPath = args.input[0] ?? LOCAL_CONFIG_PATH

    let config = await loadConfig(configPath, true)

    if (configPath.startsWith('gh:')) {
      const localConfig = await loadConfig(LOCAL_CONFIG_PATH)
      config = mergeConfig(localConfig, config)
      await saveConfig(config, LOCAL_CONFIG_PATH)
    }

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
      )
      await updateGitignore(repo.outputDirectory)
    }
  },
)