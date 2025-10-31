import { initializeIpc } from '../../utils/ipc.mjs'
import { installSafeArborist } from './arborist/index.mts'

// Initialize IPC data handling.
initializeIpc()

installSafeArborist()
