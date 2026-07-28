# ghd

Download files from a GitHub repo using glob patterns.

```sh
ghd add OWNER/REPO[/path/to/directory] --output-directory docs --include '**/*.md'
```

## Requirements

- [GitHub CLI](https://cli.github.com/) installed and authenticated with `gh auth login`

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

`ghd install` can be pointed at other ghd config files including remote files hosted on GitHub using the `gh:` prefix:

```sh
ghd install path/to/downloads.yaml
ghd install gh:OWNER/REPO/path/to/ghd.config.yaml
```

## Remote indexes

`ghd add` can be used with any repo you have access to but requires specifying include glob patterns and an output directory.

An index provides reusable include, exclude, and output-directory defaults. It is a YAML file stored in a GitHub repository:

```yaml
# OWNER/INDEX_REPO/path/to/ghd.templates.yaml
repos:
  OWNER/REPO/path/to/templates:
    metadata: # Optional - can include any additional data
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

Configure and validate a global index:

```sh
ghd indexes add OWNER/INDEX_REPO/path/to/ghd.templates.yaml
```

Now you can run

```sh
ghd add OWNER/REPO/path/to/templates
```

Without specifying include, exclude or output directory. Default values can be overriden

```sh
ghd add OWNER/REPO/path/to/templates -o generated/my-templates
```

Manage and view the configured indexes with:

```sh
ghd indexes list
ghd indexes list --format yaml
ghd indexes view
ghd indexes view OWNER/INDEX_REPO/path/to/ghd.templates.yaml
ghd indexes remove OWNER/INDEX_REPO/path/to/ghd.templates.yaml
```

## Command reference

```text
ghd add <OWNER/REPO[/path][@COMMIT_SHA]>
  --output-directory, -o <path>  Directory where files are downloaded
  --include, -i <glob>           File or glob to include (repeatable)
  --exclude, -e <glob>           File or glob to exclude (repeatable)
  --index <location>             Index location to load (repeatable)
  --config, -c <path>            Local config to update (default: ghd.config.yaml)
  --force, -f                    Write into an existing target directory

ghd install [local-config=ghd.config.yaml]
  --force, -f             Download entries whose target directories exist

ghd indexes add <location>                 Validate and add an index
ghd indexes list [--format json|yaml]      Print configured indexes
ghd indexes remove <location>              Remove a configured index
ghd indexes view [indexes...] [--format json|yaml]

ghd upgrade [--tag <tag>] [--check]
ghd --version
```

Run `ghd <command> --help` for command-specific help.

## Development

Requires [bun](https://bun.com/docs)

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
