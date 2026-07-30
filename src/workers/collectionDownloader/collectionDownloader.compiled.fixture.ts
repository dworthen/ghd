import { type IndexManager, type IndexRecord } from '../../index/index'
import { DefaultCollectionDownloader } from './collectionDownloader'

const collectionDirectory = process.argv[2]
if (!collectionDirectory) throw new Error('Missing collection directory')

const record: IndexRecord = {
  repoDirectory: 'owner/repo/compiled-worker',
  collection: 'compiled',
  description: 'compiled worker description',
  include: ['**/*'],
  exclude: [],
  outputDirectory: 'output',
}

const manager: IndexManager = {
  async *indexes() {
    yield 'fixture/index.yaml'
  },
  async *records(index) {
    if (index === 'fixture/index.yaml') yield record
  },
}

// useWebWorkers: true so the compiled binary actually resolves and runs the
// embedded worker (the whole point of this fixture).
await new DefaultCollectionDownloader(
  manager,
  collectionDirectory,
  undefined,
  true,
).download()