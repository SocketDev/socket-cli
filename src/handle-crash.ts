// By default this doesn't do anything.
// There's a special cli package in the @socketsecurity scope that is identical
// to this package, except it actually handles error crash reporting.

import { envAsBoolean } from '@socketsecurity/registry/lib/env'

export async function handle(err: unknown) {
  if (envAsBoolean(process.env['SOCKET_CLI_DEBUG'])) {
    console.error('An unexpected but caught error happened:', err)
  }
}
