#!/usr/bin/env node
/**
 * Output platform targets for shell scripts. Used by publish workflow to
 * iterate over platforms.
 *
 * Usage: node scripts/get-platform-targets.mts.
 *
 * # Outputs space-separated: linux-x64 linux-arm64 ...
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { PLATFORM_TARGETS } from '../../packages/build-infra/lib/platform-targets.mts'

const logger = getDefaultLogger()

logger.log(PLATFORM_TARGETS.join(' '))
