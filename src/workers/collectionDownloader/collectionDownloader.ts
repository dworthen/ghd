import { availableParallelism } from 'node:os'
import { type StructuredCloneable, WorkerPool } from '../../channel'
import {
  type CollectionCache,
  CollectionCacheService,
} from '../../collectionCache'
import { type Index, type IndexManager } from '../../index/index'
import { CollectionDirectory } from '../../paths'
import { WorkerPaths } from '../workers'
import { downloadCollection } from './downloadCollection'
import {
  type CollectionDownloaderWorkerResult,
  isCollectionDownloaderWorkerError,
} from './types'

// Keep batches small so we never hold too many records in memory at once (and,
// in worker mode, never structured-clone an oversized message).
const batchSize = 512
export const collectionDownloaderConcurrency = Math.min(
  availableParallelism(),
  4,
)

export interface CollectionDownloader {
  download(): Promise<void>
}

export class DefaultCollectionDownloader implements CollectionDownloader {
  #indexManager: IndexManager
  #collectionDirectory: string
  #collectionCacheService: CollectionCacheService
  #useWebWorkers: boolean

  constructor(
    indexManager: IndexManager,
    collectionDirectory: string = CollectionDirectory,
    collectionCacheService: CollectionCacheService = new CollectionCacheService(),
    useWebWorkers = false,
  ) {
    this.#indexManager = indexManager
    this.#collectionDirectory = collectionDirectory
    this.#collectionCacheService = collectionCacheService
    this.#useWebWorkers = useWebWorkers
  }

  async download(): Promise<void> {
    const collectionCache = await this.#collectionCacheService.read()
    for await (const index of this.#indexManager.indexes()) {
      const indexHash = await this.#indexManager.hash(index)
      if (collectionCache.indexes[index] === indexHash) continue

      if (this.#useWebWorkers) {
        await this.#downloadWithWorkers(index, collectionCache)
      } else {
        await this.#downloadOnMainThread(index, collectionCache)
      }
      collectionCache.indexes[index] = indexHash
      await this.#collectionCacheService.save()
    }
    await this.#collectionCacheService.save()
  }

  // Batch the index and hand each batch to downloadCollection on this thread.
  // downloadCollection bounds its own file-open concurrency, so this stays safe
  // without the overhead of spawning workers.
  async #downloadOnMainThread(
    index: string,
    collectionCache: CollectionCache,
  ): Promise<void> {
    const options = {
      collectionCache,
      collectionDirectory: this.#collectionDirectory,
    }
    let batch: Index = []
    const flush = async () => {
      Object.assign(
        collectionCache.files,
        await downloadCollection(batch, options),
      )
      batch = []
    }
    for await (const record of this.#indexManager.records(index)) {
      batch.push(record)
      if (batch.length === batchSize) await flush()
    }
    if (batch.length > 0) await flush()
  }

  // Batch the index and fan the batches out across a pool of web workers.
  async #downloadWithWorkers(
    index: string,
    collectionCache: CollectionCache,
  ): Promise<void> {
    const pool = this.#createPool(collectionCache)
    let sendingError: unknown

    const sending = (async () => {
      let batch: Index = []
      try {
        for await (const record of this.#indexManager.records(index)) {
          batch.push(record)
          if (batch.length === batchSize) {
            await pool.send(batch as unknown as StructuredCloneable)
            batch = []
          }
        }
        if (batch.length > 0) {
          await pool.send(batch as unknown as StructuredCloneable)
        }
      } finally {
        await pool.close()
      }
    })().catch((error) => {
      sendingError = error
    })

    const workerError = await this.#mergeResults(pool, collectionCache)
    await sending
    if (sendingError !== undefined) throw sendingError
    if (workerError !== undefined) throw workerError
  }

  #createPool(
    collectionCache: CollectionCache,
  ): WorkerPool<StructuredCloneable, CollectionDownloaderWorkerResult> {
    return new WorkerPool<
      StructuredCloneable,
      CollectionDownloaderWorkerResult
    >(WorkerPaths.CollectionDownloader, {
      concurrency: collectionDownloaderConcurrency,
      workerOptions: {
        collectionCache,
        collectionDirectory: this.#collectionDirectory,
      },
    })
  }

  async #mergeResults(
    pool: WorkerPool<StructuredCloneable, CollectionDownloaderWorkerResult>,
    collectionCache: CollectionCache,
  ): Promise<Error | undefined> {
    let workerError: Error | undefined
    for await (const result of pool.results) {
      if (isCollectionDownloaderWorkerError(result)) {
        workerError ??= new Error(
          result.collectionDownloaderWorkerError.message,
        )
      } else {
        Object.assign(collectionCache.files, result)
      }
    }
    return workerError
  }
}

export default DefaultCollectionDownloader