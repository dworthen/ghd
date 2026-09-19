# ghd

- Download files from a GitHub using glob patterns.
- Optionally save a lock file for repeat downloads

```sh
ghd pull OWNER/REPO[/path/to/directory] <output_directory> --include '**/*.md'
```

## Requirements

- [GitHub CLI](https://cli.github.com/) installed and authenticated with `gh auth login`.

## Install

### NPM

```sh
# Globally
npm install -g @d-dev/ghd
# or as a package dep
npm install -D @d-dev/ghd
# or run with npx
npx @d-dev/ghd <command>
```

### Or from GitHub Releases (https://github.com/dworthen/ghd/releases)

#### Windows (PowerShell)

```powershell
gh api "repos/dworthen/ghd/contents/scripts/install.ps1" -H "Accept: application/vnd.github.raw" | Out-String | iex
```

#### macOS, Linux, and WSL

```bash
gh api "repos/dworthen/ghd/contents/scripts/install.sh" -H "Accept: application/vnd.github.raw" | bash
```

## Upgrade

Use the `ghd` tool to self-upgrade anytime.

```shell
ghd upgrade
```

## Quick start

```sh
# Pull down all files from some repo to cwd
ghd pull OWNER/REPO .
# Download all markdown files to docs
ghd pull OWNER/REPO docs --include '**/*.md'
# Combine patterns
ghd pull OWNER/REPO/packages/cli . -i '**/*.ts' -i '**/*.md' -e '**/*.test.ts'

# Push files to a repo. Must have write access
# Push all markdown files from ./docs to repo.
ghd push ./docs OWNER/REPO/examples -i '**/*.md'
```

## Lock files

Pulling with the save option, `ghd pull OWNER/REPO . -s`, creates a local `.ghd.config.yaml` file acting like a lock file in ways

```yaml
# .ghd.config.yaml
repos:
  - repoDirectory: OWNER/REPO/some/path/to/directory
    commit: some_commit_hash
    include:
      []
    exclude:
      []
    outputDirectory: testing.he `ghd.config.yaml` can be used to restore every entry at its recorded commit:
```

To install from a lock file run `ghd install`.

`ghd install` can be pointed at other ghd config files including remote files hosted on GitHub using the `gh:` prefix:

```sh
ghd install path/to/.ghd.config.yaml
ghd install gh:OWNER/REPO/path/to/.ghd.config.yaml
```

## Command reference

Run `ghd --help` for help or `ghd <command> --help` for command-specific help.

## Development

Requires [bun](https://bun.com/docs)

```sh
bun install
bun run check
bun run check:changelog
bun run build
```

To build one target instead of all eight targets:

```sh
bun run build bun-darwin-arm64
```

Other target names are defined in [`scripts/build.ts`](scripts/build.ts).

After making changes run `bun run changelog:add` to add a changelog entry.

Pull requests are expected to pass the tests, build, Biome checks, and changelog check.

## License

[MIT](LICENSE)
