import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  FileAlreadyExistsError,
  FileNotLoadedError,
  InvalidFileExtensionError,
  ValidationError,
} from '../errors'
import {
  isUserConfigDocument,
  UserConfig,
  UserConfigDirectory,
  UserConfigPath,
} from './index'

const temporaryDirectories: string[] = []

async function temporaryConfigPath(extension = '.yaml'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ghd-user-config-'))
  temporaryDirectories.push(directory)
  return join(directory, '.ghd', `ghd.config${extension}`)
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('UserConfig paths', () => {
  test('uses GHD_CONFIG_DIRECTORY or the user .ghd directory', () => {
    expect(UserConfigDirectory).toBe(
      process.env.GHD_CONFIG_DIRECTORY ?? join(homedir(), '.ghd'),
    )
    expect(UserConfigPath).toBe(join(UserConfigDirectory, 'ghd.config.yaml'))
  })

  test('reads GHD_CONFIG_DIRECTORY when the module initializes', async () => {
    const configDirectory = join(tmpdir(), 'ghd-custom-config')
    const modulePath = import.meta.resolve('./index.ts')
    const child = Bun.spawn(
      [
        process.execPath,
        '-e',
        `import { UserConfigDirectory, UserConfigPath } from ${JSON.stringify(modulePath)}; console.log(JSON.stringify({ UserConfigDirectory, UserConfigPath }))`,
      ],
      {
        env: { ...process.env, GHD_CONFIG_DIRECTORY: configDirectory },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])

    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
      UserConfigDirectory: configDirectory,
      UserConfigPath: join(configDirectory, 'ghd.config.yaml'),
    })
  })

  test.each(['config.json', 'config.yaml.backup', 'config.YAML'])(
    'rejects a non-YAML path %p',
    (path) => {
      expect(() => new UserConfig(path)).toThrow(InvalidFileExtensionError)
      expect(() => new UserConfig(path)).toThrow(
        `User configuration path must end with .yml or .yaml: ${resolve(path)}`,
      )
    },
  )

  test.each(['config.yml', 'config.yaml'])('accepts YAML path %p', (path) => {
    expect(() => new UserConfig(path)).not.toThrow()
  })
})

describe('UserConfig document validation', () => {
  test('requires a unique list of verbatim strings', () => {
    const indexes = ['owner/repo/index.yaml', '  custom index  ']
    expect(isUserConfigDocument({ indexes })).toBe(true)
    expect(isUserConfigDocument({ indexes: [] })).toBe(true)
    expect(isUserConfigDocument({ index: 'owner/repo/index.yaml' })).toBe(false)
    expect(isUserConfigDocument({ indexes: {} })).toBe(false)
    expect(isUserConfigDocument({ indexes: [42] })).toBe(false)
    expect(
      isUserConfigDocument({
        indexes: ['owner/repo/index.yaml', 'owner/repo/index.yaml'],
      }),
    ).toBe(false)
  })

  test('validate rejects an unloaded config with the custom error', async () => {
    const path = await temporaryConfigPath()
    await expect(new UserConfig(path).validate()).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(new UserConfig(path).validate()).rejects.toThrow(
      `User configuration at ${resolve(path)} has not been loaded.`,
    )
  })
})

describe('UserConfig read', () => {
  test.each([undefined, '', '  \n'])(
    'returns the default document for missing or empty contents %p',
    async (contents) => {
      const path = await temporaryConfigPath()
      if (contents !== undefined) await Bun.write(path, contents)
      expect(await new UserConfig(path).read()).toEqual({ indexes: [] })
    },
  )

  test('parses, validates, preserves extra fields and caches by identity', async () => {
    const path = await temporaryConfigPath()
    await Bun.write(
      path,
      "indexes: [owner/repo/index.yaml, '  value  ']\nother: preserved\n",
    )
    const file = new UserConfig(path)
    const first = await file.read()
    await Bun.write(path, 'indexes: [changed/repo/index.yaml]\n')
    const second = await file.read()

    expect(second).toBe(first)
    expect(second as unknown).toEqual({
      indexes: ['owner/repo/index.yaml', '  value  '],
      other: 'preserved',
    })
  })

  test.each([
    '{}\n',
    'indexes: {}\n',
    'indexes: [owner/repo/index.yaml, 42]\n',
    'indexes: [same, same]\n',
    '- item\n',
  ])(
    'rejects an invalid document with ValidationError: %p',
    async (contents) => {
      const path = await temporaryConfigPath()
      await Bun.write(path, contents)
      await expect(new UserConfig(path).read()).rejects.toBeInstanceOf(
        ValidationError,
      )
    },
  )

  test('wraps malformed YAML in ValidationError', async () => {
    const path = await temporaryConfigPath()
    await Bun.write(path, 'indexes: [unterminated')
    await expect(new UserConfig(path).read()).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(new UserConfig(path).read()).rejects.toThrow(
      `User configuration at ${resolve(path)} is not valid YAML`,
    )
  })
})

describe('UserConfig save', () => {
  test('creates parent directories and serializes loaded config as YAML', async () => {
    const path = await temporaryConfigPath('.yml')
    const file = new UserConfig(path)
    const config = await file.read()
    config.indexes.push('owner/repo/index.yaml')
    await file.save()

    expect(Bun.YAML.parse(await Bun.file(path).text())).toEqual({
      indexes: ['owner/repo/index.yaml'],
    })
  })

  test('rejects an unloaded config unless saveEmpty is true', async () => {
    const path = await temporaryConfigPath()
    const file = new UserConfig(path)
    await expect(file.save()).rejects.toBeInstanceOf(FileNotLoadedError)
    expect(await Bun.file(path).exists()).toBe(false)

    await file.save(false, true)
    expect(await Bun.file(path).text()).toBe('')
  })

  test('throwIfExists rejects without overwriting', async () => {
    const path = await temporaryConfigPath()
    await Bun.write(path, 'original')
    const file = new UserConfig(path)
    await expect(file.save(true, true)).rejects.toBeInstanceOf(
      FileAlreadyExistsError,
    )
    expect(await Bun.file(path).text()).toBe('original')
  })
})