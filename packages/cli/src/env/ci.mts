/**
 * CI environment variable.
 * Set to true/1 when running in a continuous integration environment.
 */

import { getCI } from '@socketsecurity/lib/env/ci'

export const CI = getCI()
