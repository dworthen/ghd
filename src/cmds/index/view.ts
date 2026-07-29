import { createCommand } from '@d-dev/roar'
import { DefaultIndexManager, type IndexRecord } from '../../index/index'
import { UserConfig } from '../../userConfig'

export const viewIndexCmd = createCommand(
  {
    usageName: 'ghd index view',
    description: 'Print records from configured indexes',
    flags: {
      format: {
        type: 'string',
        shortFlag: 'f',
        choices: ['pretty', 'json', 'yaml'],
        default: 'pretty',
        description: 'Output format',
      },
    },
  },
  async (args) => {
    if (args.input.length !== 0) {
      throw new Error(
        'The index view command does not accept positional arguments.',
      )
    }
    const config = await new UserConfig().read()
    const manager = new DefaultIndexManager(config.indexes)

    let count = 0
    for await (const record of manager.records()) {
      switch (args.flags.format) {
        case 'json':
          if (count === 0) {
            process.stdout.write('[')
          } else {
            // process.stdout.write('\b\b')
            process.stdout.write(', ')
          }
          process.stdout.write(JSON.stringify(record, null, 2))
          count++
          break
        case 'yaml':
          console.log(Bun.YAML.stringify([record], null, 2))
          break
        default:
          printRecord(record)
          break
      }
    }
    if (count > 0 && args.flags.format === 'json') {
      process.stdout.write(']')
    }
  },
)

export function printRecord(record: IndexRecord): void {
  console.log(`repoDirectory: ${record.repoDirectory}`)
  console.log(`  collection: ${record.collection}`)
  printDescription(record.description)
}

function printDescription(description: string): void {
  // determine the width of the terminal
  const terminalWidth = process.stdout.columns || 80
  const maxLineLength = terminalWidth - 8 // leave some padding
  const words = description.split(' ')
  let line = 'description:'
  let lineCount = 0
  for (const word of words) {
    if ((line + word).length > maxLineLength) {
      console.log(`${lineCount > 0 ? '    ' : '  '}${line}`)
      line = word
      lineCount++
    } else {
      line += (line ? ' ' : '') + word
    }
  }
  if (line) console.log(`${lineCount > 0 ? '    ' : '  '}${line}`)
}