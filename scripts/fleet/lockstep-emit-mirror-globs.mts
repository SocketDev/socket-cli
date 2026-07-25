#!/usr/bin/env node
/**
 * @file Thin entry shim — real script lives in lockstep/emit-mirror-globs.mts.
 *   Calls main() explicitly; a bare `import` emits nothing because the imported
 *   module's isMainModule guard is false when it is not the entry.
 */

import { main } from './lockstep/emit-mirror-globs.mts'
import { isMainModule } from './_shared/is-main-module.mts'

if (isMainModule(import.meta.url)) {
  main()
}
