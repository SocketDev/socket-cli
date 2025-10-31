import { installSafeArborist } from './arborist/index.mts'
import { initializeIpc } from '../../utils/ipc.mjs'

// Initialize IPC data handling.
initializeIpc()

installSafeArborist()
