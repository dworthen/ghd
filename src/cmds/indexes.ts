import { createCommand } from '@d-dev/roar'
import { getIndexCmd } from './indexes/get'
import { setIndexCmd } from './indexes/set'
import { viewIndexCmd } from './indexes/view'

export const indexesCmd = createCommand({
  usageName: 'ghd indexes',
  description: 'Manage configured indexes',
})

indexesCmd.addCommand('get', getIndexCmd)
indexesCmd.addCommand('set', setIndexCmd)
indexesCmd.addCommand('view', viewIndexCmd)