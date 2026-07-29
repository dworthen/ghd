export type Workers = 'IndexFileDownloader'

export const WorkerPaths: Record<Workers, string> = {
  IndexFileDownloader: IS_BINARY
    ? './workers/indexFileDownloader.ts'
    : new URL('./indexFileDownloader.ts', import.meta.url).href,
}