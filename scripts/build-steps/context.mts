/**
 * @file Shared logger + repo-root constants for the build script modules.
 *   Split out of scripts/build.mts to keep each module under the fleet
 *   file-size cap.
 */

import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { findUpPackageJson } from '@socketsecurity/lib-stable/packages/find'

export const logger = getDefaultLogger()

export const rootDir = path.dirname(findUpPackageJson(import.meta))
