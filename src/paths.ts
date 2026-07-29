import { homedir } from 'node:os'
import { join } from 'node:path'

export const UserConfigDirectory =
  process.env.GHD_CONFIG_DIRECTORY ?? join(homedir(), '.ghd')
export const UserConfigPath = join(UserConfigDirectory, 'ghd.config.yaml')