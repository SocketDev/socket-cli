import { outputCmdJson } from './output-cmd-json.mts'

export async function handleCmdJson(cwd: string) {
  await outputCmdJson(cwd)
}
