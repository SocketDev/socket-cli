#!/usr/bin/env node
/**
 * @file Thin entry shim — real CLI lives in lockstep/cli.mts. Calls main()
 *   explicitly (cli.mts no longer self-executes on import, so importing its
 *   exports for tests is side-effect-free).
 */

import { main, SCRIPT_META } from './lockstep/cli.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
