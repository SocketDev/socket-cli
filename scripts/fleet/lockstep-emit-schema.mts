#!/usr/bin/env node
/**
 * @file Thin entry shim — real script lives in lockstep/emit-schema.mts. Calls
 *   main() explicitly; a bare `import` silently emitted nothing because the
 *   imported module's isMainModule guard is false when it is not the entry.
 */

import { isMainModule } from './_shared/is-main-module.mts'
import { main } from './lockstep/emit-schema.mts'

if (isMainModule(import.meta.url)) {
  void main()
}
