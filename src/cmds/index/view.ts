import { createCommand } from '@d-dev/roar'
import {
  DefaultIndexManager,
  type IndexManager,
  type IndexRecord,
} from '../../index/index'
import { UserConfig, UserConfigPath } from '../../userConfig'

export interface ViewIndexesDependencies {
  configPath?: string
  manager?: new (indexes: string[]) => IndexManager
  log?: (...values: unknown[]) => void
}

export const viewIndexCmd = createCommand(
  {
    usageName: 'ghd index view',
    description: 'Print records from configured indexes',
  },
  async (args) => {
    if (args.input.length !== 0) {
      throw new Error(
        'The index view command does not accept positional arguments.',
      )
    }
    await viewIndexes()
  },
)

export async function viewIndexes(
  dependencies: ViewIndexesDependencies = {},
): Promise<void> {
  const config = await new UserConfig(
    dependencies.configPath ?? UserConfigPath,
  ).read()
  const Manager = dependencies.manager ?? DefaultIndexManager
  const manager = new Manager(config.indexes)
  const log = dependencies.log ?? console.log

  for await (const record of manager.records()) printRecord(record, log)
}

export function printRecord(
  record: IndexRecord,
  log: (...values: unknown[]) => void = console.log,
): void {
  log(`repoDirectory: ${record.repoDirectory}`)
  log(`  collection: ${record.collection}`)
  log(`  description: ${record.description}`)
}