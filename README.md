# ghd

`ghd` is a cross-platform command-line tool for downloading selected files from a GitHub repository without cloning the whole repository. It can pin downloads to a commit, save them in a local YAML configuration, and restore all configured downloads later.

## Features

- Download files from a repository or a directory within one
- Select files with repeatable include and exclude globs
- Access repositories through your authenticated GitHub CLI accounts
- Pin each download to the resolved commit SHA for reproducible installs
- Share file-selection rules through named remote indexes
- Install all entries from a local or remote configuration
- Update the installed binary from GitHub Releases

## Requirements

- [GitHub CLI](https://cli.github.com/) installed and authenticated with `gh auth login`
- Access to each repository you want to download from
- [Bun](https://bun.sh/) to build from source

The release installers require Bash and `tar` on Linux/macOS, or PowerShell 6 or later on Windows. The `ghd upgrade` command also requires `tar`.

## Install

Requires the [GitHub CLI](https://cli.github.com/) authenticated with the appropriate account.

### Windows (PowerShell)

```powershell
gh api "repos/dworthen/ghd/contents/scripts/install.ps1" -H "Accept: application/vnd.github.raw+json" > install.ps1
.\install.ps1
rm install.ps1
```

### macOS, Linux, and WSL

```bash
gh api "repos/dworthen/ghd/contents/scripts/install.sh" -H "Accept: application/vnd.github.raw+json" > install.sh
chmod +x install.sh
./install.sh
rm install.sh
```

## Upgrade

Use the `ghd` tool to self-upgrade anytime.

```shell
ghd upgrade
```

## Quick start

Download every Markdown file from a repository into `docs/`:

```sh
ghd add OWNER/REPO --output-directory docs --include '**/*.md'
```

Download from a directory within a repository and combine multiple patterns:

```sh
ghd add OWNER/REPO/path/to/templates --output-directory generated \
  --include '**/*.ts' \
  --include '**/*.json' \
  --exclude '**/*.test.ts'
```

Patterns are evaluated relative to the requested repository directory. Quote globs so that your shell does not expand them.

By default, `add`:

1. resolves the repository's current default-branch commit,
2. downloads the matching files,
3. records the selection and resolved commit in `ghd.config.yaml`, and
4. adds the output directory to an existing `.gitignore`.

If the target already exists, use `--force` to overwrite matching downloaded files:

```sh
ghd add OWNER/REPO --output-directory assets --include '**/*' --force
```

You can pin the source explicitly with a full or abbreviated commit SHA:

```sh
ghd add OWNER/REPO/path/to/files@COMMIT_SHA --output-directory assets --include '**/*'
```

Branches and tags are not accepted in place of a commit SHA.

## Local configuration

A successful `ghd add` creates or updates `ghd.config.yaml`:

```yaml
repos:
  OWNER/REPO/path/to/templates:
    include:
      - "**/*.ts"
      - "**/*.json"
    exclude:
      - "**/*.test.ts"
    outputDirectory: generated
    commit: 0123456789abcdef0123456789abcdef01234567
```

The `ghd.config.yaml` can be used to restore every entry at its recorded commit:

```sh
ghd install
```

`ghd install` uses `ghd.config.yaml` in the current directory by default. You can provide another file, download configured entries even when their output directories already exist, or install a configuration stored in GitHub:

```sh
ghd install path/to/downloads.yaml
ghd install --force
ghd install gh:OWNER/REPO/path/to/ghd.config.yaml
```

A remote configuration is merged into the current directory's `ghd.config.yaml` after it is installed.

## Remote indexes

An index provides reusable include, exclude, and output-directory defaults. It is a YAML file stored in a GitHub repository:

```yaml
repos:
  OWNER/REPO/path/to/templates:
    metadata:
      type: templates
      languages:
        - typescript
        - json
      stable: true
    description: Shared TypeScript and JSON templates
    include:
      - "**/*.ts"
      - "**/*.json"
    exclude:
      - "**/*.test.ts"
    outputDirectory: generated/templates
```

Metadata values must be primitives or arrays of primitives. Nested metadata
objects are not supported.

Configure and validate one or more named global indexes:

```sh
ghd indexes set templates OWNER/INDEX_REPO/path/to/templates.yaml
ghd indexes set docs OWNER/INDEX_REPO/path/to/docs.yaml
```

The global configuration is stored at `~/.ghd/ghd.config.yaml` as a mapping
from index names to GitHub locations:

```yaml
indexes:
  templates: OWNER/INDEX_REPO/path/to/templates.yaml
  docs: OWNER/INDEX_REPO/path/to/docs.yaml
```

By default, all configured indexes are loaded and merged. An indexed repository
can therefore be added without explicit selection flags:

```sh
ghd add OWNER/REPO/path/to/templates
```

`--include`, `--exclude`, and `--output-directory` each overwrite only their corresponding indexed value when specified. If the GitHub path is not in the merged indexes, `--include` and `--output-directory` are required and `--exclude` defaults to an empty list.

Use repeatable `--index` flags with configured names to load only selected
indexes for one invocation:

```sh
ghd add OWNER/REPO/path/to/templates \
  --index templates \
  --index docs
```

Manage and view the configured indexes with:

```sh
ghd indexes get templates
ghd indexes view
ghd indexes view templates docs
ghd indexes view templates --format yaml
```

## Command reference

```text
ghd add <OWNER/REPO[/path][@COMMIT_SHA]>
  --output-directory, -o <path>  Directory where files are downloaded
  --include, -i <glob>           File or glob to include (repeatable)
  --exclude, -e <glob>           File or glob to exclude (repeatable)
  --index <name>                 Configured index name to load (repeatable)
  --config, -c <path>            Local config to update (default: ghd.config.yaml)
  --force, -f                    Write into an existing target directory

ghd install [local-config=ghd.config.yaml]
  --force, -f             Download entries whose target directories exist

ghd indexes get <name>                 Print a configured index location
ghd indexes set <name> <location>      Validate and configure a named index
ghd indexes view [names...] [--format json|yaml]

ghd upgrade [--tag <tag>] [--check]
ghd --version
```

Run `ghd <command> --help` for command-specific help.

## Upgrade

Check for a newer release or install it in place:

```sh
ghd upgrade --check
ghd upgrade
```

Install a particular release with `ghd upgrade --tag vX.Y.Z`. Self-upgrade works only from an installed `ghd` binary, not when running the TypeScript entry point through Bun.

## Development

```sh
bun install
bun test
bun run check
bun run check:changelog
bun run build
```

To build one target instead of all eight targets:

```sh
bun run build bun-darwin-arm64
```

Other target names are defined in [`scripts/build.ts`](scripts/build.ts). Pull requests are expected to pass the tests, build, Biome checks, and changelog check.

## License

[MIT](LICENSE)
