import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type CollectionCache,
  CollectionCacheService,
} from '../../collectionCache'
import { type IndexManager, type IndexRecord } from '../../index/index'
import { hashStringToHex } from '../../utils/hash'
import {
  collectionDownloaderConcurrency,
  DefaultCollectionDownloader,
  indexCacheDuration,
} from './collectionDownloader'

const temporaryDirectories: string[] = []

const indexSlug = 'owner/index/cache.yaml'

async function temporaryCollectionDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ghd-collection-service-'))
  temporaryDirectories.push(directory)
  return directory
}

function cachePathFor(collectionDirectory: string): string {
  return join(collectionDirectory, 'cache.yaml')
}

function downloader(
  manager: IndexManager,
  collectionDirectory: string,
  useWebWorkers: boolean,
): DefaultCollectionDownloader {
  return new DefaultCollectionDownloader(
    manager,
    collectionDirectory,
    new CollectionCacheService(cachePathFor(collectionDirectory)),
    useWebWorkers,
  )
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
}, 30_000)

function record(id: number): IndexRecord {
  return {
    repoDirectory: `owner/repo/path-${id}`,
    collection: id % 2 === 0 ? 'even' : 'odd',
    description: `description ${id}`,
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

  async *indexes(): AsyncIterableIterator<string> {
    yield indexSlug
  }

  async *records(index: string): AsyncIterableIterator<IndexRecord> {
    if (index === indexSlug) yield* this.#records
  }
}

describe('DefaultCollectionDownloader', () => {
  test('uses the required bounded concurrency for the worker pool', () => {
    expect(collectionDownloaderConcurrency).toBe(
      Math.min(availableParallelism(), 4),
    )
  })

  // The same behaviour is expected whether records are processed on the main
  // thread or fanned out to web workers.
  for (const { label, useWebWorkers } of [
    { label: 'main thread', useWebWorkers: false },
    { label: 'web workers', useWebWorkers: true },
  ]) {
    describe(`useWebWorkers=${useWebWorkers} (${label})`, () => {
      test('merges the existing cache and writes changed collection files', async () => {
        const collectionDirectory = await temporaryCollectionDirectory()
        const unchanged = record(1)
        const changed = record(2)
        const existingCache: CollectionCache = {
          indexes: {},
          files: {
            preserved: 'existing-hash',
            [unchanged.repoDirectory]: hashStringToHex(unchanged.description),
            [changed.repoDirectory]: 'stale-hash',
          },
        }
        await Bun.write(
          cachePathFor(collectionDirectory),
          Bun.YAML.stringify(existingCache, null, 2),
        )
        const unchangedPath = join(
          collectionDirectory,
          unchanged.collection,
          `${hashStringToHex(unchanged.repoDirectory)}.md`,
        )
        await Bun.write(unchangedPath, 'unchanged sentinel')

        await downloader(
          new Records([unchanged, changed]),
          collectionDirectory,
          useWebWorkers,
        ).download()

        const saved = Bun.YAML.parse(
          await Bun.file(cachePathFor(collectionDirectory)).text(),
        ) as CollectionCache
        expect(saved.files).toEqual({
          preserved: 'existing-hash',
          [unchanged.repoDirectory]: hashStringToHex(unchanged.description),
          [changed.repoDirectory]: hashStringToHex(changed.description),
        })
        expect(saved.indexes[indexSlug]).toBeNumber()
        expect(
          await Bun.file(
            join(
              collectionDirectory,
              changed.collection,
              `${hashStringToHex(changed.repoDirectory)}.md`,
            ),
          ).text(),
        ).toBe(`# ${changed.repoDirectory}\n\n${changed.description}`)
        expect(await Bun.file(unchangedPath).text()).toBe('unchanged sentinel')
      })

      test('skips indexes pulled within the last 24 hours without reading records', async () => {
        const collectionDirectory = await temporaryCollectionDirectory()
        const lastDownloaded = Date.now() - indexCacheDuration + 1_000
        const existingCache: CollectionCache = {
          indexes: { [indexSlug]: lastDownloaded },
          files: { preserved: 'hash' },
        }
        await Bun.write(
          cachePathFor(collectionDirectory),
          Bun.YAML.stringify(existingCache, null, 2),
        )
        let recordReads = 0
        const manager: IndexManager = {
          async *indexes() {
            yield indexSlug
            yield indexSlug
          },
          records() {
            recordReads++
            throw new Error('fresh index records must not be read')
          },
        }

        await downloader(manager, collectionDirectory, useWebWorkers).download()

        const saved = Bun.YAML.parse(
          await Bun.file(cachePathFor(collectionDirectory)).text(),
        ) as CollectionCache
        expect(recordReads).toBe(0)
        expect(saved).toEqual(existingCache)
      })

      test('downloads an index at least 24 hours old and refreshes its timestamp', async () => {
        const collectionDirectory = await temporaryCollectionDirectory()
        const startedAt = Date.now()
        const staleTimestamp = startedAt - indexCacheDuration
        await Bun.write(
          cachePathFor(collectionDirectory),
          Bun.YAML.stringify(
            { indexes: { [indexSlug]: staleTimestamp }, files: {} },
            null,
            2,
          ),
        )

        await downloader(
          new Records([record(1)]),
          collectionDirectory,
          useWebWorkers,
        ).download()

        const saved = Bun.YAML.parse(
          await Bun.file(cachePathFor(collectionDirectory)).text(),
        ) as CollectionCache
        expect(saved.indexes[indexSlug]).toBeGreaterThanOrEqual(startedAt)
        expect(saved.files[record(1).repoDirectory]).toBe(
          hashStringToHex(record(1).description),
        )
      })

      test('writes a full batch before the index iterator completes', async () => {
        const collectionDirectory = await temporaryCollectionDirectory()
        const firstBatch = Array.from({ length: 512 }, (_, index) =>
          record(index),
        )
        const first = firstBatch[0]!
        const firstPath = join(
          collectionDirectory,
          first.collection,
          `${hashStringToHex(first.repoDirectory)}.md`,
        )
        let observedFirstBatch = false
        const manager: IndexManager = {
          async *indexes() {
            yield indexSlug
          },
          async *records() {
            yield* firstBatch
            const deadline = Date.now() + 5_000
            while (Date.now() < deadline) {
              if (await Bun.file(firstPath).exists()) {
                observedFirstBatch = true
                break
              }
              await Bun.sleep(10)
            }
            if (!observedFirstBatch)
              throw new Error('first batch was not dispatched')
            yield record(512)
          },
        }

        await downloader(manager, collectionDirectory, useWebWorkers).download()

        expect(observedFirstBatch).toBe(true)
        expect(await Bun.file(firstPath).exists()).toBe(true)
      }, 10_000)

      test('processes more than one batch without dropping records', async () => {
        const collectionDirectory = await temporaryCollectionDirectory()
        const records = Array.from({ length: 513 }, (_, index) => record(index))
        const existingCache: CollectionCache = {
          indexes: {},
          files: Object.fromEntries(
            records.map((item) => [
              item.repoDirectory,
              hashStringToHex(item.description),
            ]),
          ),
        }
        await Bun.write(
          cachePathFor(collectionDirectory),
          Bun.YAML.stringify(existingCache, null, 2),
        )

        await downloader(
          new Records(records),
          collectionDirectory,
          useWebWorkers,
        ).download()

        const saved = Bun.YAML.parse(
          await Bun.file(cachePathFor(collectionDirectory)).text(),
        ) as CollectionCache
        expect(saved.files).toEqual(existingCache.files)
        expect(Object.keys(saved.files)).toHaveLength(513)
        expect(saved.indexes[indexSlug]).toBeNumber()
      })

      test('writes every collection for repeated repo directories', async () => {
        const collectionDirectory = await temporaryCollectionDirectory()
        const base = {
          ...record(1),
          repoDirectory: 'owner/repo/multi-collection',
          description: 'shared description',
        }
        const records = ['alpha', 'beta', 'gamma'].map((collection) => ({
          ...base,
          collection,
        }))

        await downloader(
          new Records(records),
          collectionDirectory,
          useWebWorkers,
        ).download()

        for (const item of records) {
          expect(
            await Bun.file(
              join(
                collectionDirectory,
                item.collection,
                `${hashStringToHex(item.repoDirectory)}.md`,
              ),
            ).text(),
          ).toBe(`# ${item.repoDirectory}\n\n${item.description}`)
        }
      })

      test('does not rewrite matching cached records', async () => {
        const collectionDirectory = await temporaryCollectionDirectory()
        const item = {
          ...record(1),
          repoDirectory: 'owner/repo/cached',
          description: 'already cached',
        }
        const path = join(
          collectionDirectory,
          item.collection,
          `${hashStringToHex(item.repoDirectory)}.md`,
        )
        await Bun.write(path, 'sentinel')
        await Bun.write(
          cachePathFor(collectionDirectory),
          Bun.YAML.stringify(
            {
              indexes: {},
              files: {
                [item.repoDirectory]: hashStringToHex(item.description),
              },
            },
            null,
            2,
          ),
        )

        await downloader(
          new Records([item]),
          collectionDirectory,
          useWebWorkers,
        ).download()

        expect(await Bun.file(path).text()).toBe('sentinel')
      })

      test('does not refresh the timestamp or save when index iteration fails', async () => {
        const collectionDirectory = await temporaryCollectionDirectory()
        const staleTimestamp = Date.now() - indexCacheDuration
        const originalContents = Bun.YAML.stringify(
          {
            indexes: { [indexSlug]: staleTimestamp },
            files: { preserved: 'hash' },
          },
          null,
          2,
        )
        await Bun.write(cachePathFor(collectionDirectory), originalContents)
        const manager: IndexManager = {
          async *indexes() {
            yield indexSlug
          },
          async *records() {
            yield record(1)
            throw new Error('index reader failed')
          },
        }

        await expect(
          downloader(manager, collectionDirectory, useWebWorkers).download(),
        ).rejects.toThrow('index reader failed')
        expect(await Bun.file(cachePathFor(collectionDirectory)).text()).toBe(
          originalContents,
        )
      }, 3_000)

      test('persists each completed index before a later index fails', async () => {
        const collectionDirectory = await temporaryCollectionDirectory()
        const firstIndex = 'owner/index/first.yaml'
        const failingIndex = 'owner/index/failing.yaml'
        const staleTimestamp = Date.now() - indexCacheDuration
        await Bun.write(
          cachePathFor(collectionDirectory),
          Bun.YAML.stringify(
            {
              indexes: { [failingIndex]: staleTimestamp },
              files: { preserved: 'hash' },
            },
            null,
            2,
          ),
        )
        const manager: IndexManager = {
          async *indexes() {
            yield firstIndex
            yield failingIndex
          },
          async *records(index) {
            if (index === firstIndex) {
              yield record(1)
              return
            }
            throw new Error('later index failed')
          },
        }

        await expect(
          downloader(manager, collectionDirectory, useWebWorkers).download(),
        ).rejects.toThrow('later index failed')

        const saved = Bun.YAML.parse(
          await Bun.file(cachePathFor(collectionDirectory)).text(),
        ) as CollectionCache
        expect(saved.indexes[firstIndex]).toBeNumber()
        expect(saved.indexes[failingIndex]).toBe(staleTimestamp)
        expect(saved.files).toEqual({
          preserved: 'hash',
          [record(1).repoDirectory]: hashStringToHex(record(1).description),
        })
      }, 3_000)

      test('rejects filesystem failures without hanging', async () => {
        const collectionDirectory = await temporaryCollectionDirectory()
        const blockedCollection = 'blocked-by-file'
        await Bun.write(join(collectionDirectory, blockedCollection), 'blocked')
        const item = { ...record(1), collection: blockedCollection }

        await expect(
          downloader(
            new Records([item]),
            collectionDirectory,
            useWebWorkers,
          ).download(),
        ).rejects.toBeInstanceOf(Error)
        expect(await Bun.file(cachePathFor(collectionDirectory)).exists()).toBe(
          false,
        )
      }, 3_000)

      test('creates and saves an empty cache when the index has no records', async () => {
        const collectionDirectory = await temporaryCollectionDirectory()
        await downloader(
          new Records([]),
          collectionDirectory,
          useWebWorkers,
        ).download()

        const saved = Bun.YAML.parse(
          await Bun.file(cachePathFor(collectionDirectory)).text(),
        ) as CollectionCache
        expect(saved.files).toEqual({})
        expect(saved.indexes[indexSlug]).toBeNumber()
      })
    })
  }

  test('runs the embedded worker from a compiled executable', async () => {
    const collectionDirectory = await temporaryCollectionDirectory()
    const executable = join(
      collectionDirectory,
      process.platform === 'win32'
        ? 'compiled-fixture.exe'
        : 'compiled-fixture',
    )
    const build = await Bun.build({
      entrypoints: [
        './src/workers/collectionDownloader/collectionDownloader.compiled.fixture.ts',
        './src/workers/collectionDownloader/collectionDownloader.worker.ts',
        // Anchor the bundle's common root at ./src (as ./src/index.ts does in
        // the real build) so the embedded worker keeps its nested path.
        './src/index.ts',
      ],
      define: { IS_BINARY: JSON.stringify(true) },
      compile: { outfile: executable },
    })
    expect(build.success).toBe(true)

    const child = Bun.spawn([executable, collectionDirectory], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, GHD_CONFIG_DIRECTORY: collectionDirectory },
    })
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ])
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(
      await Bun.file(
        join(
          collectionDirectory,
          'compiled',
          `${hashStringToHex('owner/repo/compiled-worker')}.md`,
        ),
      ).text(),
    ).toBe('# owner/repo/compiled-worker\n\ncompiled worker description')
  }, 30_000)
})