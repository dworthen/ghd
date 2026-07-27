import { createCommand } from '@d-dev/roar'
import {
  type Index,
  type LoadIndexesDependencies,
  loadIndexes,
} from '../../indexes'

export type ViewFormat = 'json' | 'yaml'
export type ViewIndexDependencies = LoadIndexesDependencies<
  Index['repos'][string]
>

export const viewIndexCmd = createCommand(
  {
    usageName: 'ghd indexes view [names...]',
    description: 'Download, merge, and print configured indexes',
    flags: {
      format: {
        type: 'string',
        shortFlag: 'f',
        choices: ['json', 'yaml'],
        default: 'json',
        description: 'Output format',
      },
    },
  },
  async (args) => {
    console.log(
      await viewIndexes(
        args.input.length === 0 ? undefined : args.input,
        args.flags.format as ViewFormat,
      ),
    )
  },
)

export async function viewIndexes(
  names: string[] | undefined,
  format: ViewFormat = 'json',
  dependencies: ViewIndexDependencies = {},
): Promise<string> {
  const loaded = await loadIndexes(names, dependencies)
  return stringifyIndex(loaded, format)
}

export function stringifyIndex(index: Index, format: ViewFormat): string {
  return format === 'yaml'
    ? Bun.YAML.stringify(index, null, 2)
    : JSON.stringify(index, null, 2)
}