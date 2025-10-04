#!/usr/bin/env node

/** @fileoverview Yarn CLI wrapper entry point. Forwards to Socket Firewall (sfw) for security scanning. */

import { forwardToSfw } from './utils/cmd.mts'

void (async () => {
  const result = await forwardToSfw('yarn', process.argv.slice(2))

  if (!result.ok) {
    process.exitCode = result.code || 1
  }
})()
