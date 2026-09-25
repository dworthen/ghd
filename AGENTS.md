# AGENTS.md

## Project Overview

`ghd` is a cross-platform command-line tool for downloading files from GitHub. It is
built with Bun and TypeScript and ships as self-contained, compiled binaries for Linux,
macOS, and Windows (x64 and arm64). The published repository is `dworthen/ghd`.

## Languages and Tooling

- **Language:** TypeScript (ESM, `strict` mode, targets ESNext)
- **Runtime:** Bun (configured via `bunfig.toml`)
- **CLI framework:** `@d-dev/roar` (`createCommand`)
- **Interactive prompts:** `@inquirer/prompts`
- **Lint/format:** Biome (`@biomejs/biome`)
- **Release tooling:** `@d-dev/changelog` (changelog management) and `@d-dev/bin-upload`
  (binary packaging + GitHub release publishing). Do not manually add changelog entries or run `bun run changelog:add`.
- **Runtime dependency:** GitHub CLI (`gh`) — required by the `upgrade` command
- **utils**: Utils directories has utilities for common problems. Use when possible instead of reinventing.s

Prefer using Bun APIs over Node APIs when possible (https://bun.com/llms.txt). Here are some examples:

- Use Bun for file IO https://bun.com/docs/runtime/file-io
- Use Bun for globbing https://bun.com/docs/runtime/glob
- Use Bun for hashing https://bun.com/docs/runtime/hashing
- Use Bun for working with yaml https://bun.com/docs/runtime/yaml and serialize with `Bun.YAML.stringify(object, null, 2)`
- Use Bun server for web server https://bun.com/docs/runtime/http/server
- Use Bun Shell for running sub process commands https://bun.sh/docs/runtime/shell

## Setup Commands

- Install dependencies: `bun install`
- Run locally: `bun run src/index.ts <command>` (e.g. `bun run src/index.ts hello --name World`)
- Build all standalone binaries: `bun run build`
- Build a single target: `bun run scripts/build.ts <target>` (e.g. `bun-darwin-arm64`)
- Package + publish binaries (used in CI): `bun run pack`, then `bun run publish`

## Code Styles and Linting Commands

- Formatter/linter: Biome (`biome.json`)
- Check formatting + lint: `bun run check`
- Auto-fix: `bun run fix`
- Conventions: single quotes, trailing commas everywhere, semicolons only as needed,
  imports auto-organized, inline `type` imports
- Honors `.editorconfig` and `.gitignore`; `noExplicitAny` and `noNonNullAssertion` are disabled

## Testing Instructions and Commands

- Use Bun's built-in test runner (https://bun.sh/docs/test): add `*.test.ts` files and run `bun test`.
- Focus on writing unit tests and using mocks. Do not test the CLI commands.
- CI quality gate (`.github/workflows/pr.yml`) runs on every PR: `bun install`,
  `bun run build`, `bun run check`, `bun run check:changelog`.

## Architecture Patterns

- Prefer functions over classes.
- Functions should implement types for composability.
- Required function parameters should be listed out while optional parameters are grouped into an `options` object.
- Functions that use fetch to make network request should accept the fetch function as an optional argument for testing capabilities.
- Use the `generateMockFetch` utlity function when testing functions that use a fetch client.
- Here is an example of a proper function

```typescript
type SomeFunctionOptions = {
  someParam?: bool
  fetch?: Fetch
}

type SomeFunctionResult = {
  ok: false
  errors: string[]
} | {
  ok: true
  result: string
}

type SomeFunction = (arg1: string, arg2: bool, options?: SomeFunctionOptions) => Promise<SomeFunctionResult>

const someFunction: SomeFunction = (arg1, arg2, { someParam = false, fetch: fetch } = {}) {
  ...
}
```

## Considerations

- **Entry point:** `src/index.ts` builds the root CLI with `@d-dev/roar`, registers
  subcommands via `cli.addCommand(...)`, and centralizes error handling (graceful Ctrl+C
  for `@inquirer/prompts`).
- **Commands:** one file per command in `src/cmds/` (`hello.ts`, `upgrade.ts`), each
  exporting a `createCommand({...}, handler)`.
- Commands should call out to testable functions/logic.
- **Domain types:** Keep domain types (for example, `Config` and `Index`) in a
  dedicated domain module together with their related loading, parsing, validation,
  mutation, and saving functions. Commands should import and orchestrate those APIs
  rather than declaring domain types or implementing persistence and parsing inline.
- **Build:** `scripts/build.ts` cross-compiles standalone executables for 8 targets
  (Linux/macOS/Windows × x64/arm64, including musl) into `bin/` via `Bun.build({ compile })`.
- **`IS_BINARY` flag:** declared in `src/globals.d.ts`; `true` in compiled binaries
  (build-time define), `false` in dev/test (`bunfig.toml` `[define]`).
- **Distribution:** `bin-upload.config.yaml` archives binaries (tar.gz/zip) and publishes
  GitHub releases to `dworthen/ghd`; the `upgrade` command self-updates the installed
  binary using the `gh` CLI.
- **Versioning:** `@d-dev/changelog` with entries under `.changelog/`
  (`bun run changelog:add`, `changelog:apply`, `check:changelog`).
- **CI:** `pr.yml` (build + checks) and `release.yml` (pack + publish on `v*` tags).
