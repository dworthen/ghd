import { homedir } from 'node:os'
import { resolve } from 'node:path'

function resolveHomeDir(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return resolve(homedir(), path.slice(2))
  }
  return path
}

export function resolvePath(...paths: string[]): string {
  paths = paths.map((p) => resolveHomeDir(p))
  return resolve(...paths).replaceAll('\\', '/')
}