import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { applyLogout } from './apply-logout.ts'

export function attemptLogout() {
  try {
    applyLogout()
    new Spinner().success('Successfully logged out')
  } catch {
    new Spinner().success('Failed to complete logout steps')
  }
}
