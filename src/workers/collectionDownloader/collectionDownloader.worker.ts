import { getEnvironmentData } from 'node:worker_threads'
import { type Index } from '../../index/index'
import { downloadCollection } from './downloadCollection'
import {
  type CollectionDownloaderWorkerOptions,
  type CollectionDownloaderWorkerResult,
} from './types'

declare const self: Worker

const options = getEnvironmentData(
  'options',
) as CollectionDownloaderWorkerOptions

self.onmessage = async ({ data }: MessageEvent<Index>) => {
  try {
    self.postMessage(await downloadCollection(data, options))
  } catch (error) {
    self.postMessage({
      collectionDownloaderWorkerError: {
        message: error instanceof Error ? error.message : String(error),
      },
    } satisfies CollectionDownloaderWorkerResult)
  }
}