import { isMainModule } from '../../fleet/process/is-main-module.mts'
import { runMain } from '../../fleet/process/run-main.mts'
import { main as buildCli } from './build.mts'

import type { ScriptMeta } from '../../fleet/process/run-main.mts'

export async function main(): Promise<void> {
  await buildCli()
}

const SCRIPT_META: ScriptMeta = {
  describe: 'build the JavaScript CLI distribution',
  help: 'Usage: pnpm run build:js',
  json: 'native',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
