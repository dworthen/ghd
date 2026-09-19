import { readdir, rm, stat } from 'node:fs/promises'
import { relative } from 'node:path'
import { Glob } from 'bun'
import { resolvePath } from './resolvePath'

export async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await stat(resolvePath(path))
    return stats.isDirectory()
  } catch {
    return false
  }
}

export async function rmDir(path: string): Promise<void> {
  const dirPath = resolvePath(path)
  if (await isDirectory(dirPath)) {
    await rm(dirPath, { recursive: true })
  }
}

export async function getFiles(
  srcDirectory: string,
  includes: string[],
  excludes: string[],
): Promise<Array<[string, string]>> {
  const dirPath = resolvePath(srcDirectory)
  const includeGlobs = includes.map((pattern) => new Glob(pattern))
  const excludeGlobs = excludes.map((pattern) => new Glob(pattern))
  if (!(await isDirectory(dirPath))) {
    throw new Error(`${dirPath} is not a directory`)
  }
  const allFiles = await readdir(dirPath, {
    recursive: true,
    withFileTypes: true,
  })
  const localFiles: Array<[string, string]> = []
  for (const file of allFiles) {
    if (file.isFile()) {
      const fullPath = resolvePath(file.parentPath, file.name)
      const relativePath = relative(dirPath, fullPath).replace(/\\/g, '/')

      const included =
        includeGlobs.length === 0 ||
        includeGlobs.some((glob) => glob.match(relativePath))
      const excluded = excludeGlobs.some((glob) => glob.match(relativePath))

      if (included && !excluded) {
        localFiles.push([fullPath, relativePath])
      }
    }
  }
  return localFiles
}