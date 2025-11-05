/**
 * IPC (Inter-Process Communication) object getter.
 * Handles communication between parent and child processes.
 */

export interface IpcObject {
  SOCKET_CLI_FIX?: string | undefined
  SOCKET_CLI_OPTIMIZE?: boolean | undefined
  SOCKET_CLI_SHADOW_ACCEPT_RISKS?: boolean | undefined
  SOCKET_CLI_SHADOW_API_TOKEN?: string | undefined
  SOCKET_CLI_SHADOW_BIN?: string | undefined
  SOCKET_CLI_SHADOW_PROGRESS?: boolean | undefined
  SOCKET_CLI_SHADOW_SILENT?: boolean | undefined
}

let _ipcObject: IpcObject | undefined

export async function getIpc(): Promise<IpcObject>
export async function getIpc<K extends keyof IpcObject>(
  key: K,
): Promise<IpcObject[K]>
export async function getIpc(
  key?: keyof IpcObject,
): Promise<IpcObject | IpcObject[keyof IpcObject]> {
  if (_ipcObject === undefined) {
    _ipcObject = {}

    // Check for IPC environment variables.
    const { env } = process

    if (env['SOCKET_CLI_FIX']) {
      _ipcObject.SOCKET_CLI_FIX = env['SOCKET_CLI_FIX']
    }

    if (env['SOCKET_CLI_OPTIMIZE']) {
      _ipcObject.SOCKET_CLI_OPTIMIZE =
        env['SOCKET_CLI_OPTIMIZE'] === 'true' ||
        env['SOCKET_CLI_OPTIMIZE'] === '1'
    }

    if (env['SOCKET_CLI_SHADOW_ACCEPT_RISKS']) {
      _ipcObject.SOCKET_CLI_SHADOW_ACCEPT_RISKS =
        env['SOCKET_CLI_SHADOW_ACCEPT_RISKS'] === 'true' ||
        env['SOCKET_CLI_SHADOW_ACCEPT_RISKS'] === '1'
    }

    if (env['SOCKET_CLI_SHADOW_API_TOKEN']) {
      _ipcObject.SOCKET_CLI_SHADOW_API_TOKEN =
        env['SOCKET_CLI_SHADOW_API_TOKEN']
    }

    if (env['SOCKET_CLI_SHADOW_BIN']) {
      _ipcObject.SOCKET_CLI_SHADOW_BIN = env['SOCKET_CLI_SHADOW_BIN']
    }

    if (env['SOCKET_CLI_SHADOW_PROGRESS']) {
      _ipcObject.SOCKET_CLI_SHADOW_PROGRESS =
        env['SOCKET_CLI_SHADOW_PROGRESS'] === 'true' ||
        env['SOCKET_CLI_SHADOW_PROGRESS'] === '1'
    }

    if (env['SOCKET_CLI_SHADOW_SILENT']) {
      _ipcObject.SOCKET_CLI_SHADOW_SILENT =
        env['SOCKET_CLI_SHADOW_SILENT'] === 'true' ||
        env['SOCKET_CLI_SHADOW_SILENT'] === '1'
    }

    Object.freeze(_ipcObject)
  }

  return key ? _ipcObject[key] : _ipcObject
}

export default getIpc
