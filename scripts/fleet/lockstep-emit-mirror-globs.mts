#!/usr/bin/env node
/**
 * @file Thin entry shim — real script lives in lockstep/emit-mirror-globs.mts.
 *   Calls main() explicitly; a bare `import` emits nothing because the imported
 *   module's isMainModule guard is false when it is not the entry.
 */

import { main, SCRIPT_META } from './lockstep/emit-mirror-globs.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
