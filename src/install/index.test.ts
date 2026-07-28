import { afterEach, describe, expect, test } from 'bun:test'
import { lstat, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { install, installReport, parseRemoteConfigLocation } from '.'
import { type LocalConfig } from './local-config'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ghd-install-'))
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

describe('install', () => {
  test('defaults to ghd.config.yaml, skips existing directories, and starts missing downloads in parallel', async () => {
    const cwd = await temporaryDirectory()
    const config: LocalConfig = {
      repos: {
        'owner/existing': {
          include: ['existing'],
          exclude: [],
          outputDirectory: 'existing',
          commit: 'aaaa',
        },
        'owner/first': {
          include: ['first', 'first'],
          exclude: ['ignored'],
          outputDirectory: 'first',
          commit: 'bbbb',
        },
        'owner/second': {
          include: ['second'],
          exclude: [],
          outputDirectory: 'second',
          commit: 'cccc',
        },
      },
    }
    await Bun.write(
      join(cwd, 'ghd.config.yaml'),
      Bun.YAML.stringify(config, null, 2),
    )
    await mkdir(join(cwd, 'existing'))

    const calls: Array<{ repository: string; options: unknown }> = []
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const installation = install(
      undefined,
      { cwd },
      {
        download: async (repository, _outputDirectory, options) => {
          calls.push({ repository, options })
          await gate
          return {
            status: 'downloaded',
            targetDirectory: repository,
            commit: 'commit',
            files: ['file'],
          }
        },
      },
    )

    while (calls.length < 2) await Bun.sleep(1)
    expect(calls.map((call) => call.repository).sort()).toEqual([
      'owner/first@bbbb',
      'owner/second@cccc',
    ])
    release?.()

    expect(await installation).toEqual({
      source: 'ghd.config.yaml',
      results: [
        {
          repository: 'owner/existing',
          outputDirectory: 'existing',
          status: 'skipped',
        },
        {
          repository: 'owner/first',
          outputDirectory: 'first',
          status: 'downloaded',
        },
        {
          repository: 'owner/second',
          outputDirectory: 'second',
          status: 'downloaded',
        },
      ],
    })
    expect(
      calls.find((call) => call.repository === 'owner/first@bbbb')?.options,
    ).toEqual({
      include: ['first', 'first'],
      exclude: ['ignored'],
      force: true,
      cwd,
      record: false,
      loadGlobalIndex: false,
    })
  })

  test('skips a symlink or junction to an existing directory without force', async () => {
    const cwd = await temporaryDirectory()
    const existing = join(cwd, 'existing')
    const linked = join(cwd, 'linked')
    await mkdir(existing)
    await symlink(
      existing,
      linked,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await Bun.write(
      join(cwd, 'ghd.config.yaml'),
      `repos:
  owner/repo:
    include: ['*']
    exclude: []
    outputDirectory: linked
    commit: abcdef
`,
    )
    let downloads = 0

    const result = await install(
      undefined,
      { cwd },
      {
        download: async () => {
          downloads += 1
          throw new Error('must not download')
        },
      },
    )

    expect(result.results).toEqual([
      {
        repository: 'owner/repo',
        outputDirectory: 'linked',
        status: 'skipped',
      },
    ])
    expect(downloads).toBe(0)
    expect((await lstat(linked)).isSymbolicLink()).toBe(true)
  })

  test('does not load an unrelated global index during config-driven installation', async () => {
    const cwd = await temporaryDirectory()
    const globalConfigPath = join(cwd, 'global.yaml')
    await Bun.write(
      globalConfigPath,
      'indexes: [index-owner/index-repo/index.yaml]\n',
    )
    await Bun.write(
      join(cwd, 'ghd.config.yaml'),
      `repos:
  owner/repo:
    include: ['*']
    exclude: []
    outputDirectory: dist
    commit: abcdef
`,
    )
    const requests: string[] = []

    const result = await install(
      undefined,
      { cwd },
      {
        globalConfigPath,
        getGithubToken: async (repo) => {
          expect(repo).toBe('owner/repo')
          return 'token'
        },
        fetch: (async (input: string | URL | Request) => {
          const url = String(input)
          requests.push(url)
          if (url.includes('/contents/index.yaml')) {
            throw new Error('unrelated global index was loaded')
          }
          if (url.includes('/git/ref/'))
            return new Response('', { status: 404 })
          if (url.endsWith('/commits/abcdef')) {
            return Response.json({ sha: 'abcdef1234567890' })
          }
          if (url.includes('/git/trees/')) return Response.json({ tree: [] })
          throw new Error(`Unexpected URL: ${url}`)
        }) as typeof globalThis.fetch,
      },
    )

    expect(result.results[0]?.status).toBe('no-files')
    expect(requests.some((url) => url.includes('index-owner'))).toBe(false)
  })
  test('force downloads every entry, including existing directories', async () => {
    const cwd = await temporaryDirectory()
    await mkdir(join(cwd, 'existing'))
    await Bun.write(
      join(cwd, 'custom.yaml'),
      `repos:
  owner/repo:
    include: ['**/*']
    exclude: []
    outputDirectory: existing
    commit: abcdef
`,
    )
    const calls: string[] = []

    const result = await install(
      'custom.yaml',
      { cwd, force: true },
      {
        download: async (repository) => {
          calls.push(repository)
          return {
            status: 'downloaded',
            targetDirectory: 'existing',
            commit: 'abcdef',
            files: ['file'],
          }
        },
      },
    )

    expect(calls).toEqual(['owner/repo@abcdef'])
    expect(result.results[0]?.status).toBe('downloaded')
  })

  test('fetches a gh: config, installs it, then merges it into local ghd.config.yaml', async () => {
    const cwd = await temporaryDirectory()
    await Bun.write(
      join(cwd, 'ghd.config.yaml'),
      `localMetadata: keep
repos:
  local/only:
    include: [local]
    exclude: []
    outputDirectory: local
    commit: '1111'
  shared/repo:
    include: [old]
    exclude: []
    outputDirectory: old
    commit: '2222'
`,
    )
    const remote = `remoteMetadata: added
repos:
  shared/repo:
    include: [new]
    exclude: [skip]
    outputDirectory: shared
    commit: '3333'
  remote/only:
    include: [remote, remote]
    exclude: []
    outputDirectory: remote
    commit: '4444'
`
    let request: { url: string; headers: Headers } | undefined
    const downloaded: string[] = []

    const result = await install(
      'gh:source/configs/path/to/local/config.yaml',
      { cwd },
      {
        getGithubToken: async (repo) => {
          expect(repo).toBe('source/configs')
          return 'token'
        },
        fetch: (async (input: string | URL | Request, init?: RequestInit) => {
          request = {
            url: String(input),
            headers: new Headers(init?.headers),
          }
          return new Response(remote)
        }) as typeof globalThis.fetch,
        download: async (repository) => {
          downloaded.push(repository)
          const beforeMerge = Bun.YAML.parse(
            await Bun.file(join(cwd, 'ghd.config.yaml')).text(),
          ) as LocalConfig
          expect(beforeMerge.repos['remote/only']).toBeUndefined()
          return {
            status: 'downloaded',
            targetDirectory: repository,
            commit: 'commit',
            files: ['file'],
          }
        },
      },
    )

    expect(request?.url).toBe(
      'https://api.github.com/repos/source/configs/contents/path/to/local/config.yaml',
    )
    expect(request?.headers.get('Authorization')).toBe('Bearer token')
    expect(downloaded.sort()).toEqual(['remote/only@4444', 'shared/repo@3333'])
    expect(result.source).toBe('gh:source/configs/path/to/local/config.yaml')
    expect(
      Bun.YAML.parse(await Bun.file(join(cwd, 'ghd.config.yaml')).text()),
    ).toEqual({
      localMetadata: 'keep',
      remoteMetadata: 'added',
      repos: {
        'local/only': {
          include: ['local'],
          exclude: [],
          outputDirectory: 'local',
          commit: '1111',
        },
        'shared/repo': {
          include: ['new'],
          exclude: ['skip'],
          outputDirectory: 'shared',
          commit: '3333',
        },
        'remote/only': {
          include: ['remote', 'remote'],
          exclude: [],
          outputDirectory: 'remote',
          commit: '4444',
        },
      },
    })
  })

  test('does not merge a remote config when a download fails', async () => {
    const cwd = await temporaryDirectory()
    await expect(
      install(
        'gh:owner/repo/config.yaml',
        { cwd },
        {
          getGithubToken: async () => 'token',
          fetch: (async (_input: string | URL | Request) =>
            new Response(`repos:
  owner/repo:
    include: ['*']
    exclude: []
    outputDirectory: dist
    commit: abc
`)) as typeof globalThis.fetch,
          download: async () => {
            throw new Error('download failed')
          },
        },
      ),
    ).rejects.toThrow('download failed')
    expect(await Bun.file(join(cwd, 'ghd.config.yaml')).exists()).toBe(false)
  })

  test('reports downloaded, skipped, and no-files outcomes verbatim', () => {
    expect(
      installReport({
        source: 'config.yaml',
        results: [
          {
            repository: 'owner/downloaded',
            outputDirectory: 'one',
            status: 'downloaded',
          },
          {
            repository: 'owner/skipped',
            outputDirectory: 'two',
            status: 'skipped',
          },
          {
            repository: 'owner/empty',
            outputDirectory: 'three',
            status: 'no-files',
          },
        ],
      }),
    ).toEqual([
      'Downloaded owner/downloaded to one.',
      'Skipped owner/skipped; two already exists.',
      'No files downloaded for owner/empty to three.',
    ])
  })
})

describe('parseRemoteConfigLocation', () => {
  test('preserves a valid GitHub config slug', () => {
    expect(
      parseRemoteConfigLocation('OWNER/REPO/path/to/local/config.yaml'),
    ).toEqual({ repo: 'OWNER/REPO', path: 'path/to/local/config.yaml' })
  })

  test.each([
    '',
    'owner',
    'owner/repo',
    'owner/repo/',
    'owner/repo/config.yml',
  ])('rejects an invalid GitHub config slug: %p', (value) =>
    expect(() => parseRemoteConfigLocation(value)).toThrow(),
  )
})