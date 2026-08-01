import { afterEach, describe, expect, test } from 'bun:test'
import { link, lstat, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IndexNotFoundError } from '../errors'
import {
  add,
  type LocalConfig,
  parseRepositorySlug,
  resolveAddOptions,
  selectFiles,
} from './index'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ghd-add-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('parseRepositorySlug', () => {
  test('parses a repository, optional directory, and commit without rewriting them', () => {
    expect(parseRepositorySlug('owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
      path: '',
      slug: 'owner/repo',
    })
    expect(parseRepositorySlug('owner/repo/path/to/dir@abcdef1')).toEqual({
      owner: 'owner',
      repo: 'repo',
      path: 'path/to/dir',
      commit: 'abcdef1',
      slug: 'owner/repo/path/to/dir',
    })
  })

  test.each([
    '',
    'owner',
    '/repo',
    '../repo',
    'owner/.',
    'owner/..',
    'owner//path',
    'owner/repo/',
    'owner/repo@',
    'owner/repo@main',
    'owner/repo/path/../unsafe',
  ])('rejects an invalid repository slug: %p', (slug) => {
    expect(() => parseRepositorySlug(slug)).toThrow()
  })
})

describe('selectFiles', () => {
  test('preserves tree order and lets exclusions override matching inclusions', () => {
    expect(
      selectFiles(
        ['index.ts', 'scripts/a.py', 'scripts/not_me.py', 'readme.md'],
        ['index.ts', 'scripts/**/*', 'scripts/**/*'],
        ['scripts/not_me.py'],
      ),
    ).toEqual(['index.ts', 'scripts/a.py'])
  })
})

describe('resolveAddOptions', () => {
  const indexed = {
    include: ['indexed/**/*.ts', 'indexed/**/*.ts'],
    exclude: ['indexed/skip.ts'],
    outputDirectory: 'indexed-output',
  }

  test('requires include and output directory when the GitHub path is not indexed', () => {
    expect(() => resolveAddOptions('owner/repo', undefined, {}, false)).toThrow(
      'Provide --include',
    )
    expect(() =>
      resolveAddOptions('owner/repo', undefined, { include: ['**/*'] }, false),
    ).toThrow('Provide --output-directory')
    expect(() =>
      resolveAddOptions(
        'owner/repo',
        undefined,
        { include: [''], outputDirectory: 'dist' },
        false,
      ),
    ).toThrow('Provide --include')
    expect(() =>
      resolveAddOptions(
        'owner/repo',
        undefined,
        { include: ['**/*'], outputDirectory: '' },
        false,
      ),
    ).toThrow('Provide --output-directory')
  })

  test('defaults exclude to an empty list when the GitHub path is not indexed', () => {
    const resolved = resolveAddOptions(
      'owner/repo',
      undefined,
      { include: ['**/*', '**/*'], outputDirectory: 'dist' },
      false,
    )

    expect(resolved).toEqual({
      include: ['**/*', '**/*'],
      exclude: [],
      outputDirectory: 'dist',
    })
    expect(Array.isArray(resolved.exclude)).toBe(true)
  })

  test('uses all indexed defaults when no optional flags are specified', () => {
    expect(resolveAddOptions('owner/repo', indexed, {}, true)).toEqual({
      include: ['indexed/**/*.ts', 'indexed/**/*.ts'],
      exclude: ['indexed/skip.ts'],
      outputDirectory: 'indexed-output',
    })
  })

  test('overwrites only the indexed values whose flags are specified', () => {
    expect(
      resolveAddOptions(
        'owner/repo',
        indexed,
        { include: ['explicit.ts'] },
        true,
      ),
    ).toEqual({
      include: ['explicit.ts'],
      exclude: ['indexed/skip.ts'],
      outputDirectory: 'indexed-output',
    })
    expect(
      resolveAddOptions(
        'owner/repo',
        indexed,
        { exclude: ['explicit-skip.ts'] },
        true,
      ),
    ).toEqual({
      include: ['indexed/**/*.ts', 'indexed/**/*.ts'],
      exclude: ['explicit-skip.ts'],
      outputDirectory: 'indexed-output',
    })
    expect(
      resolveAddOptions(
        'owner/repo',
        indexed,
        { outputDirectory: 'explicit-output' },
        true,
      ),
    ).toEqual({
      include: ['indexed/**/*.ts', 'indexed/**/*.ts'],
      exclude: ['indexed/skip.ts'],
      outputDirectory: 'explicit-output',
    })
    expect(
      resolveAddOptions(
        'owner/repo',
        indexed,
        {
          include: ['all-explicit.ts'],
          exclude: ['all-explicit-skip.ts'],
          outputDirectory: 'all-explicit-output',
        },
        true,
      ),
    ).toEqual({
      include: ['all-explicit.ts'],
      exclude: ['all-explicit-skip.ts'],
      outputDirectory: 'all-explicit-output',
    })
    expect(
      resolveAddOptions(
        'owner/repo',
        indexed,
        { include: [], exclude: [], outputDirectory: '' },
        true,
      ),
    ).toEqual({ include: [], exclude: [], outputDirectory: '' })
  })
})

describe('add', () => {
  test('creates the specified output directory without appending the GitHub directory', async () => {
    const cwd = await temporaryDirectory()
    const sha = '1234567890abcdef1234567890abcdef12345678'
    const fetch = async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://api.github.com/repos/owner/repo') {
        return Response.json({ default_branch: 'main' })
      }
      if (url.endsWith('/commits/main')) return Response.json({ sha })
      if (url.includes('/git/trees/')) {
        return Response.json({
          tree: [
            { type: 'blob', path: 'some/cool_dir/some_file.txt' },
            { type: 'blob', path: 'some/cool_dir/some_dir/nested.txt' },
          ],
        })
      }
      if (url.includes('/contents/some/cool_dir/some_file.txt')) {
        return new Response('file')
      }
      if (url.includes('/contents/some/cool_dir/some_dir/nested.txt')) {
        return new Response('nested')
      }
      throw new Error(`Unexpected URL: ${url}`)
    }

    const result = await add(
      'owner/repo/some/cool_dir',
      'testing/awesome_dir',
      { cwd, include: ['some_file.txt', 'some_dir/**/*'] },
      {
        fetch: fetch as typeof globalThis.fetch,
        getGithubToken: async () => 'token',
        globalConfigPath: join(cwd, 'missing.yaml'),
      },
    )

    expect(result).toEqual({
      status: 'downloaded',
      targetDirectory: join(cwd, 'testing/awesome_dir'),
      commit: sha,
      files: ['some_file.txt', 'some_dir/nested.txt'],
    })
    expect(
      await Bun.file(join(cwd, 'testing/awesome_dir/some_file.txt')).text(),
    ).toBe('file')
    expect(
      await Bun.file(
        join(cwd, 'testing/awesome_dir/some_dir/nested.txt'),
      ).text(),
    ).toBe('nested')
    expect(
      await Bun.file(join(cwd, 'testing/awesome_dir/cool_dir')).exists(),
    ).toBe(false)
  })

  test('downloads the literal directory example, verifies a SHA, updates config, and appends gitignore once', async () => {
    const cwd = await temporaryDirectory()
    await Bun.write(join(cwd, '.gitignore'), 'node_modules\n')
    const globalConfigPath = join(cwd, 'global.yaml')
    await Bun.write(globalConfigPath, '{}\n')
    await Bun.write(
      join(cwd, 'ghd.config.yaml'),
      `repos:
  old/invalid: 1
  old/valid:
    include: [old]
    exclude: []
    outputDirectory: old-output
    commit: old-commit
    ignored: removed
`,
    )
    const sha = 'abcdef1234567890abcdef1234567890abcdef12'
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.includes('/git/ref/heads/') || url.includes('/git/ref/tags/')) {
        return new Response('', { status: 404 })
      }
      if (url.endsWith('/commits/abcdef1')) return Response.json({ sha })
      if (url.includes('/git/trees/')) {
        return Response.json({
          tree: [
            { type: 'blob', path: 'testing/cool_dir/index.ts' },
            {
              type: 'blob',
              path: 'testing/cool_dir/scripts/files_and_directories_other_than_not_me.py',
            },
            { type: 'blob', path: 'testing/cool_dir/scripts/not_me.py' },
            { type: 'blob', path: 'testing/outside.ts' },
            { type: 'tree', path: 'testing/cool_dir/scripts' },
          ],
        })
      }
      if (url.includes('/contents/testing/cool_dir/index.ts')) {
        return new Response('export {}\n')
      }
      if (
        url.includes(
          '/contents/testing/cool_dir/scripts/files_and_directories_other_than_not_me.py',
        )
      ) {
        return new Response('print("a")\n')
      }
      throw new Error(`Unexpected URL: ${url}`)
    }

    const result = await add(
      'owner/repo/testing/cool_dir@abcdef1',
      './dist',
      {
        cwd,
        include: ['index.ts', 'scripts/**/*'],
        exclude: ['scripts/not_me.py'],
      },
      {
        fetch: fetch as typeof globalThis.fetch,
        getGithubToken: async () => 'token',
        globalConfigPath,
      },
    )

    expect(result).toEqual({
      status: 'downloaded',
      targetDirectory: join(cwd, 'dist'),
      commit: sha,
      files: ['index.ts', 'scripts/files_and_directories_other_than_not_me.py'],
    })
    expect(await Bun.file(join(cwd, 'dist/index.ts')).text()).toBe(
      'export {}\n',
    )
    expect(
      await Bun.file(
        join(cwd, 'dist/scripts/files_and_directories_other_than_not_me.py'),
      ).text(),
    ).toBe('print("a")\n')
    expect(await Bun.file(join(cwd, 'dist/scripts/not_me.py')).exists()).toBe(
      false,
    )

    const config = Bun.YAML.parse(
      await Bun.file(join(cwd, 'ghd.config.yaml')).text(),
    ) as LocalConfig
    expect(config).toEqual({
      repos: {
        'old/valid': {
          include: ['old'],
          exclude: [],
          outputDirectory: 'old-output',
          commit: 'old-commit',
        },
        'owner/repo/testing/cool_dir': {
          include: ['index.ts', 'scripts/**/*'],
          exclude: ['scripts/not_me.py'],
          outputDirectory: './dist',
          commit: sha,
        },
      },
    })
    expect(await Bun.file(join(cwd, '.gitignore')).text()).toBe(
      'node_modules\ndist\n',
    )
    expect(
      requests.every(
        ({ init }) =>
          new Headers(init?.headers).get('X-GitHub-Api-Version') ===
            '2026-03-10' &&
          new Headers(init?.headers).get('Authorization') === 'Bearer token',
      ),
    ).toBe(true)
  })

  test('treats repeatable index values as explicit index locations', async () => {
    const cwd = await temporaryDirectory()
    const globalConfigPath = join(cwd, 'global.yaml')
    await Bun.write(
      globalConfigPath,
      'indexes: [ignored-owner/ignored-repo/index.yaml]\n',
    )
    const sha = '1234567890abcdef1234567890abcdef12345678'
    const loadedIndexes: string[] = []
    const fetch = async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://api.github.com/repos/owner/repo') {
        return Response.json({ default_branch: 'main' })
      }
      if (url.endsWith('/commits/main')) return Response.json({ sha })
      if (url.includes('/git/trees/')) {
        return Response.json({
          tree: [
            { type: 'blob', path: 'file.ts' },
            { type: 'blob', path: 'secret.ts' },
          ],
        })
      }
      if (url.includes('/contents/file.ts')) return new Response('file')
      throw new Error(`Unexpected URL: ${url}`)
    }

    const result = await add(
      'owner/repo',
      'vendor',
      { cwd, include: ['*.ts'], index: ['index-owner/index-repo/index.yaml'] },
      {
        fetch: fetch as typeof globalThis.fetch,
        getGithubToken: async () => 'token',
        globalConfigPath,
        loadRemoteIndex: async (location) => {
          loadedIndexes.push(location)
          return [
            {
              repoDirectory: 'owner/repo',
              collection: 'tools',
              description: 'Tooling files',
              include: ['**/*.ts', '*.ts'],
              exclude: ['secret.ts'],
              outputDirectory: 'generated/tools',
            },
          ]
        },
      },
    )

    expect(result.status).toBe('downloaded')
    expect(loadedIndexes).toEqual(['index-owner/index-repo/index.yaml'])
    expect(await Bun.file(join(cwd, 'vendor/file.ts')).text()).toBe('file')
    expect(await Bun.file(join(cwd, 'vendor/secret.ts')).exists()).toBe(false)
  })

  test('falls back to both index pattern lists when neither flag is explicit', async () => {
    const cwd = await temporaryDirectory()
    const globalConfigPath = join(cwd, 'global.yaml')
    await Bun.write(
      globalConfigPath,
      'indexes: [index-owner/repo/index.yaml]\n',
    )
    const sha = '1234567890abcdef1234567890abcdef12345678'
    const fetch = async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/repos/index-owner/repo/contents/index.yaml')) {
        return new Response(`- repoDirectory: owner/repo
  collection: tools
  description: Tooling files
  include: ['*.ts']
  exclude: ['skip.ts']
  outputDirectory: generated/tools
`)
      }
      if (url === 'https://api.github.com/repos/owner/repo') {
        return Response.json({ default_branch: 'main' })
      }
      if (url.endsWith('/commits/main')) return Response.json({ sha })
      if (url.includes('/git/trees/')) {
        return Response.json({
          tree: [
            { type: 'blob', path: 'file.ts' },
            { type: 'blob', path: 'skip.ts' },
          ],
        })
      }
      if (url.includes('/contents/file.ts')) return new Response('file')
      throw new Error(`Unexpected URL: ${url}`)
    }

    const result = await add(
      'owner/repo',
      undefined,
      { cwd },
      {
        fetch: fetch as typeof globalThis.fetch,
        getGithubToken: async () => 'token',
        globalConfigPath,
      },
    )

    expect(result.status === 'downloaded' && result.files).toEqual(['file.ts'])
    expect(await Bun.file(join(cwd, 'generated/tools/file.ts')).text()).toBe(
      'file',
    )
  })

  test('continues with an explicit include when the configured global index returns 404', async () => {
    const cwd = await temporaryDirectory()
    const globalConfigPath = join(cwd, 'global.yaml')
    await Bun.write(
      globalConfigPath,
      'indexes: [index-owner/index-repo/missing.yaml]\n',
    )
    const sha = '1234567890abcdef1234567890abcdef12345678'
    const fetch = async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/repos/index-owner/index-repo/contents/missing.yaml')) {
        return new Response('', { status: 404 })
      }
      if (url === 'https://api.github.com/repos/owner/repo') {
        return Response.json({ default_branch: 'main' })
      }
      if (url.endsWith('/commits/main')) return Response.json({ sha })
      if (url.includes('/git/trees/')) return Response.json({ tree: [] })
      throw new Error(`Unexpected URL: ${url}`)
    }

    const result = await add(
      'owner/repo',
      'dist',
      { cwd, include: ['README'] },
      {
        fetch: fetch as typeof globalThis.fetch,
        getGithubToken: async () => 'token',
        globalConfigPath,
      },
    )

    expect(result).toEqual({
      status: 'no-files',
      targetDirectory: join(cwd, 'dist'),
    })
  })

  test('discards matching records when a later index fails before fallback', async () => {
    const cwd = await temporaryDirectory()
    const globalConfigPath = join(cwd, 'global.yaml')
    await Bun.write(
      globalConfigPath,
      'indexes: [index-owner/one/index.yaml, index-owner/two/index.yaml]\n',
    )
    const sha = '1234567890abcdef1234567890abcdef12345678'
    const fetch = async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://api.github.com/repos/owner/repo') {
        return Response.json({ default_branch: 'main' })
      }
      if (url.endsWith('/commits/main')) return Response.json({ sha })
      if (url.includes('/git/trees/')) {
        return Response.json({
          tree: [
            { type: 'blob', path: 'keep.ts' },
            { type: 'blob', path: 'blocked.ts' },
          ],
        })
      }
      if (url.includes('/contents/keep.ts')) return new Response('keep')
      if (url.includes('/contents/blocked.ts')) return new Response('blocked')
      throw new Error(`Unexpected URL: ${url}`)
    }
    const loaded: string[] = []

    const result = await add(
      'owner/repo',
      'dist',
      { cwd, include: ['*.ts'] },
      {
        fetch: fetch as typeof globalThis.fetch,
        getGithubToken: async () => 'token',
        globalConfigPath,
        loadRemoteIndex: async (location) => {
          loaded.push(location)
          if (location.includes('/two/')) {
            throw new IndexNotFoundError('second index missing')
          }
          return [
            {
              repoDirectory: 'owner/repo',
              collection: 'tools',
              description: 'first index record',
              include: ['*.ts'],
              exclude: ['blocked.ts'],
              outputDirectory: 'ignored',
            },
          ]
        },
      },
    )

    expect(loaded).toEqual([
      'index-owner/one/index.yaml',
      'index-owner/two/index.yaml',
    ])
    expect(result.status === 'downloaded' && result.files).toEqual([
      'keep.ts',
      'blocked.ts',
    ])
    expect(await Bun.file(join(cwd, 'dist/blocked.ts')).text()).toBe('blocked')
  })

  test('continues with an explicit include when the configured index repository is missing', async () => {
    const cwd = await temporaryDirectory()
    const globalConfigPath = join(cwd, 'global.yaml')
    await Bun.write(
      globalConfigPath,
      'indexes: [missing-owner/missing-repo/index.yaml]\n',
    )
    const sha = '1234567890abcdef1234567890abcdef12345678'
    const fetch = async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://api.github.com/repos/owner/repo') {
        return Response.json({ default_branch: 'main' })
      }
      if (url.endsWith('/commits/main')) return Response.json({ sha })
      if (url.includes('/git/trees/')) return Response.json({ tree: [] })
      throw new Error(`Unexpected URL: ${url}`)
    }

    const result = await add(
      'owner/repo',
      'dist',
      { cwd, include: ['README'] },
      {
        fetch: fetch as typeof globalThis.fetch,
        getGithubToken: async (repo) => {
          if (repo === 'missing-owner/missing-repo') {
            throw new Error(`No GitHub CLI token can access ${repo}`)
          }
          return 'token'
        },
        globalConfigPath,
      },
    )

    expect(result).toEqual({
      status: 'no-files',
      targetDirectory: join(cwd, 'dist'),
    })
  })

  test('inherits indexed include when only exclude is explicit', async () => {
    const cwd = await temporaryDirectory()
    const globalConfigPath = join(cwd, 'global.yaml')
    await Bun.write(
      globalConfigPath,
      'indexes: [index-owner/repo/index.yaml]\n',
    )
    const sha = '1234567890abcdef1234567890abcdef12345678'
    const fetch = async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://api.github.com/repos/owner/repo') {
        return Response.json({ default_branch: 'main' })
      }
      if (url.endsWith('/commits/main')) return Response.json({ sha })
      if (url.includes('/git/trees/')) {
        return Response.json({ tree: [{ type: 'blob', path: 'file.ts' }] })
      }
      if (url.includes('/contents/file.ts')) return new Response('file')
      throw new Error(`Unexpected URL: ${url}`)
    }

    const result = await add(
      'owner/repo',
      'dist',
      { cwd, exclude: ['secret.ts'] },
      {
        fetch: fetch as typeof globalThis.fetch,
        getGithubToken: async () => 'token',
        globalConfigPath,
        loadRemoteIndex: async () => [
          {
            repoDirectory: 'owner/repo',
            collection: 'tools',
            description: 'Tooling files',
            include: ['*.ts'],
            exclude: [],
            outputDirectory: 'generated/tools',
          },
        ],
      },
    )

    expect(result.status).toBe('downloaded')
    expect(await Bun.file(join(cwd, 'dist/file.ts')).text()).toBe('file')
  })

  test('rejects a path-like repository before force can remove the working directory', async () => {
    const cwd = await temporaryDirectory()
    const marker = join(cwd, 'marker.txt')
    await Bun.write(marker, 'keep')

    await expect(
      add('owner/..', 'dist', { cwd, include: ['*'], force: true }),
    ).rejects.toThrow("Invalid repository 'owner/..'")
    expect(await Bun.file(marker).text()).toBe('keep')
  })

  test('skips an existing explicit target before loading a configured index', async () => {
    const cwd = await temporaryDirectory()
    const target = join(cwd, 'dist')
    const globalConfigPath = join(cwd, 'global.yaml')
    await mkdir(target, { recursive: true })
    await Bun.write(join(target, 'keep.txt'), 'keep')
    await Bun.write(
      globalConfigPath,
      'indexes: [index-owner/repo/index.yaml]\n',
    )
    let calls = 0
    const mustNotFetch: typeof globalThis.fetch = Object.assign(
      async (_input: string | URL | Request, _init?: RequestInit) => {
        calls += 1
        throw new Error('must not fetch')
      },
      { preconnect: globalThis.fetch.preconnect },
    )

    const result = await add(
      'owner/repo',
      'dist',
      { cwd, include: ['**/*'] },
      {
        fetch: mustNotFetch,
        getGithubToken: async () => {
          calls += 1
          return 'token'
        },
        globalConfigPath,
        loadRemoteIndex: async () => {
          calls += 1
          throw new Error('remote index unavailable')
        },
      },
    )

    expect(result).toEqual({ status: 'skipped', targetDirectory: target })
    expect(calls).toBe(0)
    expect(await Bun.file(join(target, 'keep.txt')).text()).toBe('keep')
    expect(await Bun.file(join(cwd, 'ghd.config.yaml')).exists()).toBe(false)
  })

  test('does not replace a dangling target symlink without force', async () => {
    const cwd = await temporaryDirectory()
    const target = join(cwd, 'dist')
    const missing = join(cwd, 'missing-target')
    await symlink(
      missing,
      target,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    let calls = 0

    const result = await add(
      'owner/repo',
      'dist',
      { cwd, include: ['**/*'] },
      {
        fetch: Object.assign(
          async () => {
            calls += 1
            throw new Error('must not fetch')
          },
          { preconnect: globalThis.fetch.preconnect },
        ),
        getGithubToken: async () => {
          calls += 1
          return 'token'
        },
        globalConfigPath: join(cwd, 'missing.yaml'),
      },
    )

    expect(result).toEqual({ status: 'skipped', targetDirectory: target })
    expect(calls).toBe(0)
    expect((await lstat(target)).isSymbolicLink()).toBe(true)
    expect(await Bun.file(missing).exists()).toBe(false)
  })

  test('returns no-files without creating output or changing config and gitignore', async () => {
    const cwd = await temporaryDirectory()
    const configPath = join(cwd, 'ghd.config.yaml')
    const gitignorePath = join(cwd, '.gitignore')
    const configContents = 'repos: {}\n'
    const gitignoreContents = 'node_modules\n'
    await Bun.write(configPath, configContents)
    await Bun.write(gitignorePath, gitignoreContents)
    const sha = '1234567890abcdef1234567890abcdef12345678'
    const fetch = async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://api.github.com/repos/owner/repo') {
        return Response.json({ default_branch: 'main' })
      }
      if (url.endsWith('/commits/main')) return Response.json({ sha })
      if (url.includes('/git/trees/')) {
        return Response.json({
          tree: [{ type: 'blob', path: 'path/to/directory/readme.md' }],
        })
      }
      throw new Error(`Unexpected URL: ${url}`)
    }

    const result = await add(
      'owner/repo/path/to/directory',
      'dist',
      { cwd, include: ['*.ts'] },
      {
        fetch: fetch as typeof globalThis.fetch,
        getGithubToken: async () => 'token',
        globalConfigPath: join(cwd, 'missing-global.yaml'),
      },
    )

    expect(result).toEqual({
      status: 'no-files',
      targetDirectory: join(cwd, 'dist'),
    })
    expect(await Bun.file(join(cwd, 'dist')).exists()).toBe(false)
    expect(await Bun.file(configPath).text()).toBe(configContents)
    expect(await Bun.file(gitignorePath).text()).toBe(gitignoreContents)
  })

  test('no-files with force preserves an existing target', async () => {
    const cwd = await temporaryDirectory()
    const target = join(cwd, 'dist')
    await mkdir(target, { recursive: true })
    await Bun.write(join(target, 'keep.txt'), 'keep')
    const sha = '1234567890abcdef1234567890abcdef12345678'
    const fetch = async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://api.github.com/repos/owner/repo') {
        return Response.json({ default_branch: 'main' })
      }
      if (url.endsWith('/commits/main')) return Response.json({ sha })
      if (url.includes('/git/trees/')) return Response.json({ tree: [] })
      throw new Error(`Unexpected URL: ${url}`)
    }

    const result = await add(
      'owner/repo',
      'dist',
      { cwd, include: ['**/*'], force: true },
      {
        fetch: fetch as typeof globalThis.fetch,
        getGithubToken: async () => 'token',
        globalConfigPath: join(cwd, 'missing.yaml'),
      },
    )

    expect(result).toEqual({ status: 'no-files', targetDirectory: target })
    expect(await Bun.file(join(target, 'keep.txt')).text()).toBe('keep')
    expect(await Bun.file(join(cwd, 'ghd.config.yaml')).exists()).toBe(false)
  })

  test('force rejects a downloaded path resolving to the target root', async () => {
    const cwd = await temporaryDirectory()
    const target = join(cwd, 'dist')
    const unsafePath = process.platform === 'win32' ? 'branch\\..' : 'branch/..'
    await mkdir(target, { recursive: true })
    await Bun.write(join(target, 'unrelated.txt'), 'unrelated')
    const sha = '1234567890abcdef1234567890abcdef12345678'
    let contentRequests = 0
    const fetch = async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://api.github.com/repos/owner/repo') {
        return Response.json({ default_branch: 'main' })
      }
      if (url.endsWith('/commits/main')) return Response.json({ sha })
      if (url.includes('/git/trees/')) {
        return Response.json({ tree: [{ type: 'blob', path: unsafePath }] })
      }
      if (url.includes('/contents/')) contentRequests += 1
      throw new Error(`Unexpected URL: ${url}`)
    }

    await expect(
      add(
        'owner/repo',
        'dist',
        { cwd, include: ['**/*', '**'], force: true },
        {
          fetch: fetch as typeof globalThis.fetch,
          getGithubToken: async () => 'token',
          globalConfigPath: join(cwd, 'missing.yaml'),
        },
      ),
    ).rejects.toThrow(`GitHub returned an unsafe path: ${unsafePath}`)

    expect(contentRequests).toBe(0)
    expect((await lstat(target)).isDirectory()).toBe(true)
    expect(await Bun.file(join(target, 'unrelated.txt')).text()).toBe(
      'unrelated',
    )
  })

  test('force preserves unrelated files and overwrites downloaded files', async () => {
    const cwd = await temporaryDirectory()
    const target = join(cwd, 'dist')
    await mkdir(target, { recursive: true })
    await Bun.write(join(target, 'stale.txt'), 'stale')
    await Bun.write(join(target, 'fresh.txt'), 'old')
    const outsideHardLink = join(cwd, 'outside-hard-link.txt')
    await Bun.write(outsideHardLink, 'outside-hard-link')
    await link(outsideHardLink, join(target, 'hard-linked.txt'))
    await Bun.write(join(cwd, '.gitignore'), './dist\n')
    const sha = '1234567890abcdef1234567890abcdef12345678'
    const fetch = async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://api.github.com/repos/owner/repo') {
        return Response.json({ default_branch: 'main' })
      }
      if (url.endsWith('/commits/main')) return Response.json({ sha })
      if (url.includes('/git/trees/')) {
        return Response.json({
          tree: [
            { type: 'blob', path: 'fresh.txt' },
            { type: 'blob', path: 'hard-linked.txt' },
          ],
        })
      }
      if (url.includes('/contents/fresh.txt')) return new Response('fresh')
      if (url.includes('/contents/hard-linked.txt')) {
        return new Response('hard-linked')
      }
      throw new Error(`Unexpected URL: ${url}`)
    }

    await add(
      'owner/repo',
      'dist',
      { cwd, include: ['**/*'], force: true },
      {
        fetch: fetch as typeof globalThis.fetch,
        getGithubToken: async () => 'token',
        globalConfigPath: join(cwd, 'missing.yaml'),
      },
    )

    expect(await Bun.file(join(target, 'stale.txt')).text()).toBe('stale')
    expect(await Bun.file(join(target, 'fresh.txt')).text()).toBe('fresh')
    expect(await Bun.file(join(target, 'hard-linked.txt')).text()).toBe(
      'hard-linked',
    )
    expect(await Bun.file(outsideHardLink).text()).toBe('outside-hard-link')
    expect(await Bun.file(join(cwd, '.gitignore')).text()).toBe('./dist\n')
  })

  test('force replaces stale file and directory path types', async () => {
    const cwd = await temporaryDirectory()
    const target = join(cwd, 'dist')
    await mkdir(join(target, 'old-directory'), { recursive: true })
    await Bun.write(join(target, 'nested'), 'old-parent-file')
    await Bun.write(join(target, 'old-directory/stale.txt'), 'stale')
    await Bun.write(join(target, 'unrelated.txt'), 'unrelated')

    const sha = '1234567890abcdef1234567890abcdef12345678'
    const fetch = async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://api.github.com/repos/owner/repo') {
        return Response.json({ default_branch: 'main' })
      }
      if (url.endsWith('/commits/main')) return Response.json({ sha })
      if (url.includes('/git/trees/')) {
        return Response.json({
          tree: [
            { type: 'blob', path: 'nested/fresh.txt' },
            { type: 'blob', path: 'old-directory' },
          ],
        })
      }
      if (url.includes('/contents/nested/fresh.txt')) {
        return new Response('nested-fresh')
      }
      if (url.includes('/contents/old-directory')) {
        return new Response('new-file')
      }
      throw new Error(`Unexpected URL: ${url}`)
    }

    await add(
      'owner/repo',
      'dist',
      { cwd, include: ['**/*'], force: true },
      {
        fetch: fetch as typeof globalThis.fetch,
        getGithubToken: async () => 'token',
        globalConfigPath: join(cwd, 'missing.yaml'),
      },
    )

    expect((await lstat(join(target, 'nested'))).isDirectory()).toBe(true)
    expect(await Bun.file(join(target, 'nested/fresh.txt')).text()).toBe(
      'nested-fresh',
    )
    expect((await lstat(join(target, 'old-directory'))).isFile()).toBe(true)
    expect(await Bun.file(join(target, 'old-directory')).text()).toBe(
      'new-file',
    )
    expect(await Bun.file(join(target, 'unrelated.txt')).text()).toBe(
      'unrelated',
    )
  })

  test('force replaces retained symlinks without writing outside the target', async () => {
    const nestedPath =
      process.platform === 'win32' ? 'nested\\nested.txt' : 'nested/nested.txt'
    const cwd = await temporaryDirectory()
    const target = join(cwd, 'dist')
    const outsideFile = join(cwd, 'outside.txt')
    const outsideDirectory = join(cwd, 'outside-directory')
    await mkdir(target, { recursive: true })
    await mkdir(outsideDirectory)
    await Bun.write(outsideFile, 'outside-file')
    await Bun.write(join(outsideDirectory, 'nested.txt'), 'outside-nested')
    await symlink(outsideFile, join(target, 'fresh.txt'), 'file')
    await symlink(
      outsideDirectory,
      join(target, 'nested'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    const sha = '1234567890abcdef1234567890abcdef12345678'
    const fetch = async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://api.github.com/repos/owner/repo') {
        return Response.json({ default_branch: 'main' })
      }
      if (url.endsWith('/commits/main')) return Response.json({ sha })
      if (url.includes('/git/trees/')) {
        return Response.json({
          tree: [
            { type: 'blob', path: 'fresh.txt' },
            { type: 'blob', path: nestedPath },
          ],
        })
      }
      if (url.includes('/contents/fresh.txt')) return new Response('fresh')
      if (url.includes('/contents/') && !url.includes('/contents/fresh.txt')) {
        return new Response('nested')
      }
      throw new Error(`Unexpected URL: ${url}`)
    }

    await add(
      'owner/repo',
      'dist',
      { cwd, include: ['**/*', '**'], force: true },
      {
        fetch: fetch as typeof globalThis.fetch,
        getGithubToken: async () => 'token',
        globalConfigPath: join(cwd, 'missing.yaml'),
      },
    )

    expect(await Bun.file(outsideFile).text()).toBe('outside-file')
    expect(await Bun.file(join(outsideDirectory, 'nested.txt')).text()).toBe(
      'outside-nested',
    )
    expect((await lstat(join(target, 'fresh.txt'))).isSymbolicLink()).toBe(
      false,
    )
    expect((await lstat(join(target, 'nested'))).isSymbolicLink()).toBe(false)
    expect(await Bun.file(join(target, 'fresh.txt')).text()).toBe('fresh')
    expect(await Bun.file(join(target, 'nested/nested.txt')).text()).toBe(
      'nested',
    )
  })

  test('force replaces a symlinked target without mutating its referent', async () => {
    const cwd = await temporaryDirectory()
    const target = join(cwd, 'dist')
    const outsideDirectory = join(cwd, 'outside-directory')
    await mkdir(outsideDirectory)
    await Bun.write(join(outsideDirectory, 'fresh.txt'), 'outside-fresh')
    await Bun.write(join(outsideDirectory, 'keep.txt'), 'outside-keep')
    await symlink(
      outsideDirectory,
      target,
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    const sha = '1234567890abcdef1234567890abcdef12345678'
    const fetch = async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://api.github.com/repos/owner/repo') {
        return Response.json({ default_branch: 'main' })
      }
      if (url.endsWith('/commits/main')) return Response.json({ sha })
      if (url.includes('/git/trees/')) {
        return Response.json({ tree: [{ type: 'blob', path: 'fresh.txt' }] })
      }
      if (url.includes('/contents/fresh.txt')) return new Response('fresh')
      throw new Error(`Unexpected URL: ${url}`)
    }

    await add(
      'owner/repo',
      'dist',
      { cwd, include: ['**/*'], force: true },
      {
        fetch: fetch as typeof globalThis.fetch,
        getGithubToken: async () => 'token',
        globalConfigPath: join(cwd, 'missing.yaml'),
      },
    )

    expect((await lstat(target)).isSymbolicLink()).toBe(false)
    expect(await Bun.file(join(target, 'fresh.txt')).text()).toBe('fresh')
    expect(await Bun.file(join(outsideDirectory, 'fresh.txt')).text()).toBe(
      'outside-fresh',
    )
    expect(await Bun.file(join(outsideDirectory, 'keep.txt')).text()).toBe(
      'outside-keep',
    )
  })

  test('walks trees recursively when GitHub truncates the recursive tree response', async () => {
    const cwd = await temporaryDirectory()
    const sha = '1234567890abcdef1234567890abcdef12345678'
    const fetch = async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://api.github.com/repos/owner/repo') {
        return Response.json({ default_branch: 'main' })
      }
      if (url.endsWith('/commits/main')) return Response.json({ sha })
      if (url.endsWith(`/git/trees/${sha}?recursive=1`)) {
        return Response.json({ tree: [], truncated: true })
      }
      if (url.endsWith(`/git/trees/${sha}`)) {
        return Response.json({
          tree: [{ type: 'tree', path: 'src', sha: 'src-tree' }],
        })
      }
      if (url.endsWith('/git/trees/src-tree')) {
        return Response.json({
          tree: [{ type: 'blob', path: 'file.ts', sha: 'blob' }],
        })
      }
      if (url.includes('/contents/src/file.ts')) return new Response('file')
      throw new Error(`Unexpected URL: ${url}`)
    }

    const result = await add(
      'owner/repo/src',
      'dist',
      { cwd, include: ['*.ts'] },
      {
        fetch: fetch as typeof globalThis.fetch,
        getGithubToken: async () => 'token',
        globalConfigPath: join(cwd, 'missing.yaml'),
      },
    )

    expect(result.status).toBe('downloaded')
    expect(await Bun.file(join(cwd, 'dist/file.ts')).text()).toBe('file')
  })

  test('requires include when no explicit or globally configured index exists', async () => {
    const cwd = await temporaryDirectory()
    await expect(
      add(
        'owner/repo',
        'dist',
        { cwd, exclude: ['secret'] },
        { globalConfigPath: join(cwd, 'missing.yaml') },
      ),
    ).rejects.toThrow('No index is configured. Provide --include')
    await mkdir(join(cwd, 'existing'))
    await expect(
      add('owner/repo', 'existing', {
        cwd,
        include: [''],
        loadGlobalIndex: false,
      }),
    ).rejects.toThrow('No index is configured. Provide --include')
  })

  test('requires output directory when no index contains the GitHub path', async () => {
    const cwd = await temporaryDirectory()
    await expect(
      add('owner/repo', undefined, {
        cwd,
        include: ['**/*'],
        loadGlobalIndex: false,
      }),
    ).rejects.toThrow('No index is configured. Provide --output-directory')
    await expect(
      add('owner/repo', '', {
        cwd,
        include: ['**/*'],
        loadGlobalIndex: false,
      }),
    ).rejects.toThrow('No index is configured. Provide --output-directory')
  })

  test('lets GitHub resolve a short unambiguous commit SHA', async () => {
    const cwd = await temporaryDirectory()
    const shortSha = '7fd1a6'
    const commit = '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d'
    const requests: string[] = []
    const fetch = async (input: string | URL | Request) => {
      const url = String(input)
      requests.push(url)
      if (url.includes('/git/ref/')) return new Response('', { status: 404 })
      if (url.endsWith(`/commits/${shortSha}`))
        return Response.json({ sha: commit })
      if (url.includes('/git/trees/')) {
        return Response.json({ tree: [{ type: 'blob', path: 'file.ts' }] })
      }
      if (url.includes('/contents/file.ts')) return new Response('file')
      throw new Error(`Unexpected URL: ${url}`)
    }

    const result = await add(
      `owner/repo@${shortSha}`,
      'dist',
      { cwd, include: ['**/*'] },
      {
        fetch: fetch as typeof globalThis.fetch,
        getGithubToken: async () => 'token',
        globalConfigPath: join(cwd, 'missing.yaml'),
      },
    )

    expect(result.status === 'downloaded' && result.commit).toBe(commit)
    expect(requests.some((url) => url.endsWith(`/commits/${shortSha}`))).toBe(
      true,
    )
  })

  test.each(['heads', 'tags'])(
    'rejects a commit resolving under %s',
    async (kind) => {
      const cwd = await temporaryDirectory()
      const fetch = async (input: string | URL | Request) => {
        const url = String(input)
        if (url.includes(`/git/ref/${kind}/abcdef1`)) {
          return Response.json({ ref: 'x' })
        }
        if (url.includes('/git/ref/')) return new Response('', { status: 404 })
        throw new Error(`Unexpected URL: ${url}`)
      }

      await expect(
        add(
          'owner/repo@abcdef1',
          'dist',
          { cwd, include: ['**/*'] },
          {
            fetch: fetch as typeof globalThis.fetch,
            getGithubToken: async () => 'token',
            globalConfigPath: join(cwd, 'missing.yaml'),
          },
        ),
      ).rejects.toThrow('Tags and branches are not allowed')
    },
  )
})