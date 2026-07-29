import { describe, expect, test } from 'bun:test'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { UserConfigDirectory, UserConfigPath } from './paths'

describe('UserConfig paths', () => {
  test('uses GHD_CONFIG_DIRECTORY or the user .ghd directory', () => {
    expect(UserConfigDirectory).toBe(
      process.env.GHD_CONFIG_DIRECTORY ?? join(homedir(), '.ghd'),
    )
    expect(UserConfigPath).toBe(join(UserConfigDirectory, 'ghd.config.yaml'))
  })

  test('reads GHD_CONFIG_DIRECTORY when the module initializes', async () => {
    const configDirectory = join(tmpdir(), 'ghd-custom-config')
    const modulePath = import.meta.resolve('./paths.ts')
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
})