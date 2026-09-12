import { runProductTests } from './product-tests.mts'
import { isMainModule } from '../../fleet/process/is-main-module.mts'
import { runMain } from '../../fleet/process/run-main.mts'

import type { ScriptMeta } from '../../fleet/process/run-main.mts'

export async function main(): Promise<void> {
  await runProductTests('e2e')
}

const SCRIPT_META: ScriptMeta = {
  describe: 'run the product end-to-end test lane',
  help: 'Usage: pnpm run test:e2e',
  json: 'native',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
