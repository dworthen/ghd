import { type CollectionCache } from '../../collectionCache'

export type CollectionDownloaderWorkerOptions = {
  collectionCache: CollectionCache
  collectionDirectory: string
}

export type CollectionDownloaderWorkerError = {
  collectionDownloaderWorkerError: {
    message: string
  }
}

export type CollectionDownloaderWorkerResult =
  | CollectionCache['files']
  | CollectionDownloaderWorkerError

export function isCollectionDownloaderWorkerError(
  value: CollectionDownloaderWorkerResult,
): value is CollectionDownloaderWorkerError {
  return typeof value.collectionDownloaderWorkerError === 'object'
}