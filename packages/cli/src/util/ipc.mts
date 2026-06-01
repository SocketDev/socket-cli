/**
 * IPC types for subprocess communication. Used as the typed shape of the `ipc`
 * field in spawn options when launching child Socket CLI processes.
 */

// IpcObject type for subprocess IPC data.
export type IpcObject = Readonly<{
  SOCKET_CLI_FIX?: string | undefined;
  SOCKET_CLI_OPTIMIZE?: boolean | undefined;
}>;
