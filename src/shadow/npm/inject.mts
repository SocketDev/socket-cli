/** @fileoverview npm Arborist injection entry point for Socket CLI. Installs safe Arborist hooks to intercept npm operations for security scanning. */

import { installSafeArborist } from './arborist/index.mts'

installSafeArborist()
