import { createCommand } from '@d-dev/roar'
import { addIndexCmd } from './index/add'
import { listIndexesCmd } from './index/list'
import { removeIndexCmd } from './index/remove'
import { viewIndexCmd } from './index/view'

export const indexCmd = createCommand({
  usageName: 'ghd index',
  description: 'Manage configured indexes',
})

indexCmd.addCommand('add', addIndexCmd)
indexCmd.addCommand('list', listIndexesCmd)
indexCmd.addCommand('remove', removeIndexCmd)
indexCmd.addCommand('view', viewIndexCmd)