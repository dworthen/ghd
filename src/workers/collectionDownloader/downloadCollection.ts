import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type CollectionCache } from '../../collectionCache'
import { type Index } from '../../index/index'
import { hashStringToHex } from '../../utils/hash'
import { type CollectionDownloaderWorkerOptions } from './types'

// Cap how many files we open at once. An unbounded Promise.all over a large
// index exhausts the process file-descriptor limit (EMFILE) — and macOS ships a
// 256 soft limit by default — so we process records with a fixed pool of
// workers regardless of how many records the caller hands us.
const writeConcurrency = 128

export async function downloadCollection(
  index: Index,
  { collectionCache, collectionDirectory }: CollectionDownloaderWorkerOptions,
): Promise<CollectionCache['files']> {
  const cache: CollectionCache['files'] = {}
  let cursor = 0

  async function work(): Promise<void> {
    while (cursor < index.length) {
      const { collection, description, repoDirectory } = index[cursor++]!
      const descriptionHash = hashStringToHex(description)
      if (collectionCache.files[repoDirectory] !== descriptionHash) {
        const outputPath = join(
          collectionDirectory,
          collection,
          `${hashStringToHex(repoDirectory)}.md`,
        )
        await mkdir(dirname(outputPath), { recursive: true })
        await Bun.write(outputPath, `# ${repoDirectory}\n\n${description}`)
      }
      cache[repoDirectory] = descriptionHash
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(writeConcurrency, index.length) }, work),
  )

  return cache
}