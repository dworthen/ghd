import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type CollectionCache,
  CollectionCacheService,
} from '../../collectionCache'
import {
  type Index,
  type IndexManager,
  type IndexRecord,
} from '../../index/index'
import { DefaultCollectionDownloader } from './collectionDownloader'

// Comparing the two DefaultCollectionDownloader modes writes tens of thousands
// of files, so it is opt-in: run it with
// `GHD_BENCHMARK=1 bun test collectionDownloader.benchmark`.
// It never asserts on wall-clock timings (those are inherently flaky); it only
// asserts that both modes produce byte-for-byte identical output and logs the
// durations for information.
const benchmarkEnabled = Boolean(process.env.GHD_BENCHMARK)
const benchmarkCount = Number(process.env.GHD_BENCHMARK_COUNT ?? 10_000)

const temporaryDirectories: string[] = []

async function temporaryCollectionDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function cachePathFor(collectionDirectory: string): string {
  return join(collectionDirectory, 'cache.yaml')
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
}, 120_000)

function record(id: number): IndexRecord {
  return {
    repoDirectory: `owner/repo/path-${id}`,
    // Spread files across a handful of collections rather than one huge folder.
    collection: `collection-${id % 8}`,
    description: `description for record ${id}`,
    include: ['**/*'],
    exclude: [],
    outputDirectory: `output-${id}`,
  }
}

class Records implements IndexManager {
  #records: IndexRecord[]

  constructor(records: IndexRecord[]) {
    this.#records = records
  }

  async *records(): AsyncIterableIterator<IndexRecord> {
    yield* this.#records
  }
}

// Snapshot of every written markdown file: relative path -> contents.
async function collectFiles(
  directory: string,
  base = directory,
): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) {
      for (const [path, contents] of await collectFiles(full, base)) {
        files.set(path, contents)
      }
    } else if (entry.name !== 'cache.yaml') {
      files.set(full.slice(base.length + 1), await Bun.file(full).text())
    }
  }
  return files
}

function mapsEqual(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false
  }
  return true
}

// Run one DefaultCollectionDownloader mode end-to-end and return how long the
// download took plus the cache map it persisted.
async function run(
  records: Index,
  prefix: string,
  useWebWorkers: boolean,
): Promise<{ ms: number; directory: string; cache: CollectionCache }> {
  const directory = await temporaryCollectionDirectory(prefix)
  const start = performance.now()
  await new DefaultCollectionDownloader(
    new Records(records),
    directory,
    new CollectionCacheService(cachePathFor(directory)),
    useWebWorkers,
  ).download()
  const ms = performance.now() - start
  const cache = Bun.YAML.parse(
    await Bun.file(cachePathFor(directory)).text(),
  ) as CollectionCache
  return { ms, directory, cache }
}

describe('DefaultCollectionDownloader main thread vs web workers', () => {
  const benchmark = benchmarkEnabled ? test : test.skip

  benchmark(
    `produces identical output for ${benchmarkCount} records (and reports timings)`,
    async () => {
      const records: Index = Array.from({ length: benchmarkCount }, (_, id) =>
        record(id),
      )

      // useWebWorkers=false: batch and run downloadCollection on this thread.
      const main = await run(records, 'ghd-bench-main-', false)
      // useWebWorkers=true: batch and fan out across the worker pool.
      const pool = await run(records, 'ghd-bench-pool-', true)

      // Correctness parity: identical cache maps and identical files on disk.
      expect(pool.cache).toEqual(main.cache)
      expect(Object.keys(main.cache)).toHaveLength(benchmarkCount)

      const [mainFiles, poolFiles] = await Promise.all([
        collectFiles(main.directory),
        collectFiles(pool.directory),
      ])
      expect(poolFiles.size).toBe(benchmarkCount)
      expect(mapsEqual(mainFiles, poolFiles)).toBe(true)

      const faster = pool.ms < main.ms ? 'web workers' : 'main thread'
      const ratio = (
        Math.max(pool.ms, main.ms) / Math.min(pool.ms, main.ms)
      ).toFixed(2)
      console.log(
        `[benchmark] records=${benchmarkCount} ` +
          `main-thread=${main.ms.toFixed(0)}ms ` +
          `web-workers=${pool.ms.toFixed(0)}ms ` +
          `-> ${faster} faster by ${ratio}x`,
      )
    },
    120_000,
  )
})