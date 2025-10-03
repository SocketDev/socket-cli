/** @fileoverview JSON command business logic handler for Socket CLI. Orchestrates socket.json file display and delegates to output formatter with target directory path. */

import { outputCmdJson } from './output-cmd-json.mts'

export async function handleCmdJson(cwd: string) {
  await outputCmdJson(cwd)
}
