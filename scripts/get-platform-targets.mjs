#!/usr/bin/env node
/**
 * Output platform targets for shell scripts.
 * Used by publish workflow to iterate over platforms.
 *
 * Usage:
 *   node scripts/get-platform-targets.mjs
 *   # Outputs space-separated: linux-x64 linux-arm64 ...
 */

import { PLATFORM_TARGETS } from '../packages/build-infra/lib/platform-targets.mjs'

console.log(PLATFORM_TARGETS.join(' '))
