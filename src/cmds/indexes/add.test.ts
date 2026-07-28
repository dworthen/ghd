import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  IndexNotFoundError,
  loadRemoteIndex,
  parseIndexLocation,
} from '../../index/index'
import { type AddIndexDependencies, addIndex } from './add'

const temporaryDirectories: string[] = []
const validIndex = `- repoDirectory: octo-org/project/packages/app
  metadata:
    type: app
    stable: true
  description: Application package
  include:
    - '**/*.ts'
  exclude:
    - '**/*.test.ts'
  outputDirectory: packages/app
`

async function temporaryConfig(contents?: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ghd-index-add-'))
  temporaryDirectories.push(directory)
  const path = join(directory, '.ghd', 'ghd.config.yaml')

  if (contents !== undefined) {
    await Bun.write(path, contents)
  }

  return path
}

function remoteDependencies(
  response: Response = new Response(validIndex),
): AddIndexDependencies & {
  repositories: string[]
  requests: Array<{ url: string; init?: RequestInit }>
} {
  const repositories: string[] = []
  const requests: Array<{ url: string; init?: RequestInit }> = []

  return {
    repositories,
    requests,
    getGithubToken: async (repo) => {
      repositories.push(repo)
      return 'github-token'
    },
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init })
      return response
    }) as typeof fetch,
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('parseIndexLocation', () => {
  test('splits an OWNER/REPO/path/to/index.yaml location', () => {
    expect(parseIndexLocation('owner/repo/path/to/index.yaml')).toEqual({
      repo: 'owner/repo',
      path: 'path/to/index.yaml',
    })
  })

  test.each([
    '',
    'owner',
    'owner/repo',
    '/repo/index.yaml',
    'owner//index.yaml',
    'owner/repo/',
    'owner/repo/path//index.yaml',
    'owner/repo/index.yml',
    'owner/repo/index.txt',
  ])('rejects invalid location %p', (location) => {
    expect(() => parseIndexLocation(location)).toThrow(
      `Invalid index '${location}'. Expected OWNER/REPO/path/to/index.yaml.`,
    )
  })
})

describe('loadRemoteIndex', () => {
  test('gets a repo token, downloads raw contents, and parses an Index', async () => {
    const dependencies = remoteDependencies()

    const index = await loadRemoteIndex(
      'octo-org/indexes/catalogs/main index.yaml',
      dependencies,
    )

    expect(index).toEqual([
      {
        repoDirectory: 'octo-org/project/packages/app',
        metadata: { type: 'app', stable: true },
        description: 'Application package',
        include: ['**/*.ts'],
        exclude: ['**/*.test.ts'],
        outputDirectory: 'packages/app',
      },
    ])
    expect(dependencies.repositories).toEqual(['octo-org/indexes'])
    expect(dependencies.requests).toEqual([
      {
        url: 'https://api.github.com/repos/octo-org/indexes/contents/catalogs/main%20index.yaml',
        init: {
          headers: {
            Accept: 'application/vnd.github.raw+json',
            Authorization: 'Bearer github-token',
            'X-GitHub-Api-Version': '2026-03-10',
          },
        },
      },
    ])
  })

  test('rejects a missing remote index', async () => {
    const dependencies = remoteDependencies(
      new Response('not found', { status: 404 }),
    )

    await expect(
      loadRemoteIndex('owner/repo/index.yaml', dependencies),
    ).rejects.toThrow(
      'Failed to get index owner/repo/index.yaml from GitHub (HTTP 404).',
    )
  })

  test('throws IndexNotFoundError when the index or its repository is missing', async () => {
    await expect(
      loadRemoteIndex(
        'owner/repo/index.yaml',
        remoteDependencies(new Response('', { status: 404 })),
      ),
    ).rejects.toBeInstanceOf(IndexNotFoundError)

    await expect(
      loadRemoteIndex('owner/repo/index.yaml', {
        getGithubToken: async () => {
          throw new Error('No GitHub CLI token can access owner/repo')
        },
      }),
    ).rejects.toBeInstanceOf(IndexNotFoundError)
  })

  test('rejects invalid YAML', async () => {
    const dependencies = remoteDependencies(new Response('- [unterminated'))

    await expect(
      loadRemoteIndex('owner/repo/index.yaml', dependencies),
    ).rejects.toThrow('Index owner/repo/index.yaml is not valid YAML')
  })

  test.each([
    ['a non-list', 'value'],
    ['a mapping', '{}'],
    [
      'missing required fields',
      '- repoDirectory: owner/repo\n  metadata: {}\n  description: Tools\n  include: []\n  exclude: []\n',
    ],
    [
      'non-string patterns',
      '- repoDirectory: owner/repo/src\n  metadata: {}\n  description: Tools\n  include: [1]\n  exclude: []\n  outputDirectory: src\n',
    ],
  ])(
    'rejects %s instead of returning a value that is not an Index',
    async (_, yaml) => {
      const dependencies = remoteDependencies(new Response(yaml))

      await expect(
        loadRemoteIndex('owner/repo/index.yaml', dependencies),
      ).rejects.toThrow(
        'Index owner/repo/index.yaml does not have the expected structure.',
      )
    },
  )
})

describe('addIndex', () => {
  test('creates the config and stores a validated index', async () => {
    const configPath = await temporaryConfig()

    await addIndex('owner/repo/index.yaml', {
      ...remoteDependencies(),
      configPath,
    })

    expect(Bun.YAML.parse(await Bun.file(configPath).text())).toEqual({
      indexes: ['owner/repo/index.yaml'],
    })
  })

  test('appends while preserving index order and other fields', async () => {
    const configPath = await temporaryConfig(
      'indexes: [old/repo/index.yaml]\nother: preserved\n',
    )

    await addIndex('new/repo/path/index.yaml', {
      ...remoteDependencies(),
      configPath,
    })

    expect(Bun.YAML.parse(await Bun.file(configPath).text())).toEqual({
      indexes: ['old/repo/index.yaml', 'new/repo/path/index.yaml'],
      other: 'preserved',
    })
  })

  test('does not add a duplicate index', async () => {
    const original = 'indexes: [owner/repo/index.yaml]\nother: preserved\n'
    const configPath = await temporaryConfig(original)

    await addIndex('owner/repo/index.yaml', {
      ...remoteDependencies(),
      configPath,
    })

    expect(await Bun.file(configPath).text()).toBe(original)
  })

  test('does not modify config when remote validation fails', async () => {
    const original = 'indexes: [old/repo/index.yaml]\n'
    const configPath = await temporaryConfig(original)

    await expect(
      addIndex('new/repo/index.yaml', {
        ...remoteDependencies(new Response('missing', { status: 404 })),
        configPath,
      }),
    ).rejects.toThrow('Failed to get index')

    expect(await Bun.file(configPath).text()).toBe(original)
  })

  test('fails when an existing config is not a YAML mapping', async () => {
    const configPath = await temporaryConfig('- list item\n')

    await expect(
      addIndex('owner/repo/index.yaml', {
        ...remoteDependencies(),
        configPath,
      }),
    ).rejects.toThrow(
      `Configuration file at ${configPath} is not a YAML mapping.`,
    )
  })
})