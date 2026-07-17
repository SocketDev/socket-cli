#!/usr/bin/env node
/**
 * @file Thin entry shim — real CLI lives in lockstep/cli.mts. Calls main()
 *   explicitly (cli.mts no longer self-executes on import, so importing its
 *   exports for tests is side-effect-free).
 */

import { main } from './lockstep/cli.mts'
import { isMainModule } from './_shared/is-main-module.mts'

if (isMainModule(import.meta.url)) {
  void main()
}
