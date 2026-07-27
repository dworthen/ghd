import { mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createCommand } from '@d-dev/roar'
import { $, Glob } from 'bun'
import pkg from '../../package.json'

export const upgradeCmd = createCommand(
  {
    usageName: 'ghd upgrade',
    description: 'Upgrade ghd to the latest release',
    flags: {
      tag: {
        type: 'string',
        shortFlag: 't',
        description: 'Release tag to install (default: latest)',
        default: 'latest',
      },
      check: {
        type: 'boolean',
        description:
          'Report whether an upgrade is available without installing',
        default: false,
      },
    },
  },
  async (args) => {
    if (!Bun.which('gh')) {
      console.error(
        'gh CLI is required but not found. Install it from https://cli.github.com/ then run "gh auth login".',
      )
      process.exit(1)
    }

    const target = getPlatformTarget()
    const wantsLatest = args.flags.tag === 'latest'
    const rawTag = wantsLatest
      ? await resolveLatestTag()
      : toReleaseTag(args.flags.tag)
    const targetVersion = normalizeVersion(rawTag)
    const upgradeAvailable = isUpgradeAvailable(CURRENT_VERSION, targetVersion)

    if (args.flags.check) {
      console.log(
        wantsLatest && !upgradeAvailable
          ? `On latest version (${CURRENT_VERSION}).`
          : `Upgrade available: ${CURRENT_VERSION} -> ${targetVersion}. Run "ghd upgrade" to install.`,
      )
      return
    }

    if (wantsLatest && !upgradeAvailable) {
      console.log(
        `Already on the latest version (${CURRENT_VERSION}). No upgrade needed.`,
      )
      return
    }

    const exe = process.execPath
    const exeName = basename(exe).toLowerCase()
    if (exeName === 'bun' || exeName === 'bun.exe') {
      console.error(
        'Upgrade is only supported for the installed ghd binary, not when running via bun.',
      )
      process.exit(1)
    }

    console.log(`Upgrading ${CURRENT_VERSION} -> ${targetVersion} ...`)
    const tmp = await mkdtemp(join(tmpdir(), 'ghd-upgrade-'))
    try {
      const archivePath = await downloadAsset(rawTag, target.asset, tmp)
      await extractArchive(archivePath, tmp, target.isZip)
      const newBinary = await findBinary(tmp, target.binaryName)
      await replaceBinary(exe, newBinary, process.platform === 'win32')
      console.log(`ghd upgraded to ${targetVersion}.`)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  },
)

export const REPO = (pkg.repository as string).replace(/^github:/, '')
export const CURRENT_VERSION = pkg.version

export interface PlatformTarget {
  key: string // e.g. 'win-x64'
  asset: string // e.g. 'win-x64.zip'
  binaryName: string // 'ghd' | 'ghd.exe'
  isZip: boolean
}

export function getPlatformTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): PlatformTarget {
  const archKey = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : null
  if (!archKey) throw new Error(`Unsupported architecture: ${arch}`)

  let os: string
  if (platform === 'win32') os = 'win'
  else if (platform === 'linux') os = 'linux'
  else if (platform === 'darwin') os = 'darwin'
  else throw new Error(`Unsupported platform: ${platform}`)

  const key = `${os}-${archKey}`
  const isZip = platform === 'win32'
  return {
    key,
    asset: `${key}.${isZip ? 'zip' : 'tar.gz'}`,
    binaryName: isZip ? 'ghd.exe' : 'ghd',
    isZip,
  }
}

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/, '')
}

export function toReleaseTag(version: string): string {
  const v = version.trim()
  return v.startsWith('v') ? v : `v${v}`
}

/** negative if a<b, 0 if equal, positive if a>b (ignores pre-release suffix) */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    (normalizeVersion(v).split('-')[0] ?? '')
      .split('.')
      .map((n) => Number(n) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function isUpgradeAvailable(current: string, latest: string): boolean {
  return compareSemver(current, latest) < 0
}

/** Windows leaves a `<exe>.old` behind after self-replace; remove it best-effort. */
export async function cleanupStaleUpgrade(
  execPath: string = process.execPath,
): Promise<void> {
  try {
    await rm(`${execPath}.old`, { force: true })
  } catch {
    // best-effort; never throw from startup cleanup
  }
}

async function resolveLatestTag(): Promise<string> {
  const { stdout, exitCode } =
    await $`gh release view --repo ${REPO} --json tagName --jq ${'.tagName'}`
      .nothrow()
      .quiet()
  const tag = stdout.toString().trim()
  if (exitCode !== 0 || !tag || tag === 'null' || tag.startsWith('{')) {
    console.error(`Could not resolve latest release tag for ${REPO}`)
    process.exit(1)
  }
  return tag
}

async function downloadAsset(
  tag: string,
  asset: string,
  dir: string,
): Promise<string> {
  console.log(`Downloading ${asset} ...`)
  const { exitCode, stderr } =
    await $`gh release download ${tag} --repo ${REPO} --pattern ${asset} --dir ${dir} --clobber`
      .nothrow()
      .quiet()
  const archivePath = join(dir, asset)
  if (exitCode !== 0 || !(await Bun.file(archivePath).exists())) {
    console.error(`Failed to download ${asset}\n${stderr.toString()}`)
    process.exit(1)
  }
  return archivePath
}

async function extractArchive(
  archivePath: string,
  dir: string,
  isZip: boolean,
): Promise<void> {
  console.log('Extracting ...')
  // bsdtar (Windows 10 1803+) extracts .zip via `tar -xf`; tar.gz via `-xzf`.
  const proc = isZip
    ? $`tar -xf ${archivePath} -C ${dir}`
    : $`tar -xzf ${archivePath} -C ${dir}`
  const { exitCode, stderr } = await proc.nothrow().quiet()
  if (exitCode !== 0) {
    console.error(`Failed to extract ${archivePath}\n${stderr.toString()}`)
    process.exit(1)
  }
}

async function findBinary(dir: string, binaryName: string): Promise<string> {
  // The binary may sit at the archive root or in a subdirectory, so match by
  // basename across all extracted files (Bun's `**/name` skips root-level files).
  const glob = new Glob('**/*')
  for await (const file of glob.scan({ cwd: dir, absolute: true })) {
    if (basename(file) === binaryName) {
      return file
    }
  }
  console.error(`${binaryName} not found in downloaded archive`)
  process.exit(1)
}

async function replaceBinary(
  exe: string,
  newBinary: string,
  isWindows: boolean,
): Promise<void> {
  // Stage next to the current exe (same filesystem) so rename is atomic
  // and avoids ETXTBSY when overwriting a running binary on Unix.
  const staged = join(dirname(exe), `.ghd.new-${process.pid}`)
  await Bun.write(Bun.file(staged), Bun.file(newBinary))

  if (isWindows) {
    await rename(exe, `${exe}.old`) // can't delete a running exe; rename is allowed
    await rename(staged, exe)
    // `${exe}.old` is removed on next startup by cleanupStaleUpgrade()
  } else {
    await $`chmod +x ${staged}`.quiet()
    await rename(staged, exe) // atomic overwrite, allowed while running on Unix
  }
}