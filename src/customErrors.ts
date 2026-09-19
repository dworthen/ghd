export class GhdError extends Error {
  constructor(message?: string) {
    super(message)
    this.name = 'GhdError'
  }
}

export class CommandNotFound extends GhdError {
  constructor(cmd: string) {
    super(
      `Command not found: '${cmd}'. Please install it and ensure it is available on path.`,
    )
    this.name = 'CommandNotFound'
  }
}

export class GithubTokensNotFound extends GhdError {
  constructor() {
    super(
      'Github tokens not found. Please run `gh auth login` to authenticate with GitHub.',
    )
    this.name = 'GithubTokensNotFound'
  }
}

export class GhAuthStatusFailure extends GhdError {
  constructor(message: string) {
    super(
      `Failed to run \`gh auth status\` command to get GitHub authentication tokens: ${message}`,
    )
    this.name = 'GhAuthStatusFailure'
  }
}

export class GhAuthorizationError extends GhdError {
  constructor(repoPath: string) {
    super(
      `Failed to obtain GitHub token for '${repoPath}'. Be sure to run \`gh auth login\` to authenticate with GitHub using the correct account or that the repo exists.`,
    )
    this.name = 'GhAuthorizationError'
  }
}

export class InvalidGithubRepoSlug extends GhdError {
  constructor(repoPath: string) {
    super(
      `Invalid GitHub repository slug: '${repoPath}'. A valid slug should be in the format 'owner/repo[/additional/path][@commitSha]'.`,
    )
    this.name = 'InvalidGithubRepoSlug'
  }
}

export class GithubRequestFailure extends GhdError {
  constructor(endpoint: string, status: number, message: string) {
    super(
      `GitHub request to '${endpoint}' failed with status ${status}: ${message}`,
    )
    this.name = 'GithubRequestFailure'
  }
}