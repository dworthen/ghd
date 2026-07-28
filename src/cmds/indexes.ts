import { createCommand } from '@d-dev/roar'
import { addIndexCmd } from './indexes/add'
import { listIndexesCmd } from './indexes/list'
import { removeIndexCmd } from './indexes/remove'
import { viewIndexCmd } from './indexes/view'

export const indexesCmd = createCommand({
  usageName: 'ghd indexes',
  description: 'Manage configured indexes',
})

indexesCmd.addCommand('add', addIndexCmd)
indexesCmd.addCommand('list', listIndexesCmd)
indexesCmd.addCommand('remove', removeIndexCmd)
indexesCmd.addCommand('view', viewIndexCmd)