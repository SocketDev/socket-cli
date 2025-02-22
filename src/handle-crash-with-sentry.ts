// In a Sentry build, this file will replace the `handle_crash.ts`, see rollup.
//
// This is intended to send a caught-but-unexpected exception to Sentry
// It only works in a special @socketsecurity/cli-with-sentry build.
//
// The regular build will not have the Sentry dependency at all because we
// don't want to give people the idea that we're using it to gather telemetry.

// @ts-ignore
import * as sentry from '@sentry/node'

// Note: Make sure not to exit() explicitly after calling this command. Sentry
//       needs some time to finish the fetch() but it doesn't return a promise.
export async function handle(err: unknown) {
  if (process.env['SOCKET_CLI_DEBUG'] === '1') {
    console.log('Sending to Sentry...')
  }
  sentry.captureException(err)
  if (process.env['SOCKET_CLI_DEBUG'] === '1') {
    console.log('Request to Sentry initiated.')
  }

  // "Sleep" for a second, just in case, hopefully enough time to initiate fetch
  return await new Promise(r => setTimeout(r, 1000))
}
