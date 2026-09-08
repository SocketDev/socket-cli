/**
 * CI environment variable. Set to true/1 when running in a continuous
 * integration environment.
 */

import { isCI } from '@socketsecurity/lib-stable/env/ci'

export const CI = isCI()
