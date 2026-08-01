export type Workers = 'CollectionDownloader'

export const WorkerPaths: Record<Workers, string> = {
  CollectionDownloader: IS_BINARY
    ? './workers/collectionDownloader/collectionDownloader.worker.ts'
    : new URL(
        './collectionDownloader/collectionDownloader.worker.ts',
        import.meta.url,
      ).href,
}