#!/usr/bin/env node
import { releasePackagesForVersion } from './packages.mts'
import { isMainModule } from '../lib/is-main-module.mts'
import { runMain } from '../lib/run-main.mts'

const RELEASE_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u

export interface AvailabilityOptions {
  readonly fetcher?: typeof fetch
  readonly now?: () => number
  readonly signal?: AbortSignal
  readonly wait?: (
    milliseconds: number,
    signal?: AbortSignal,
  ) => Promise<void>
  readonly timeoutMs?: number
}

function waitForDelay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (): void => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    const abort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(signal?.reason)
    }
    const timer = setTimeout(finish, milliseconds)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {abort()}
  })
}

function retryDelay(response: Response, fallback: number, now: number): number {
  const value = response.headers.get('retry-after')
  if (!value) {return fallback}
  const seconds = Number(value)
  if (Number.isFinite(seconds)) {
    return seconds > 0 ? seconds * 1000 : fallback
  }
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(1_000, date - now) : fallback
}

export async function waitForNpmVersion(
  name: string,
  version: string,
  options: AvailabilityOptions = {},
): Promise<void> {
  if (!RELEASE_VERSION.test(version)) {
    throw new TypeError(`Invalid npm release version: ${version}`)
  }
  const fetcher = options.fetcher ?? fetch
  const now = options.now ?? Date.now
  const wait = options.wait ?? waitForDelay
  const deadline = now() + (options.timeoutMs ?? 30 * 60_000)
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
  let delay = 2_000

  while (true) {
    const remaining = deadline - now()
    if (remaining <= 0) {
      throw new Error(
        `Timed out waiting for npm to expose ${name}@${version}; no GitHub release was created. Retry finalization with the same stage ID.`,
      )
    }
    const timeout = AbortSignal.timeout(Math.min(30_000, remaining))
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout
    let response: Response
    try {
      // eslint-disable-next-line no-await-in-loop -- Poll until npm reports the package as public.
      response = await fetcher(url, {
        method: 'HEAD',
        redirect: 'manual',
        signal,
      })
    } catch (error) {
      if (options.signal?.aborted) {
        throw error
      }
      // eslint-disable-next-line no-await-in-loop -- Back off before retrying the registry request.
      await wait(Math.min(delay, deadline - now()), options.signal)
      delay = Math.min(delay * 2, 60_000)
      continue
    }
    if (response.status === 200) {
      return
    }
    if (
      response.status !== 404 &&
      response.status !== 429 &&
      (response.status < 500 || response.status > 599)
    ) {
      throw new Error(`npm availability check returned HTTP ${response.status}.`)
    }
    const waitMs = retryDelay(response, delay, now())
    // eslint-disable-next-line no-await-in-loop -- Respect retry-after and back off for pending npm versions.
    await wait(Math.min(waitMs, deadline - now()), options.signal)
    delay = Math.min(delay * 2, 60_000)
  }
}

export async function waitForReleasePackages(
  version: string,
  options: AvailabilityOptions = {},
): Promise<readonly string[]> {
  const packages = releasePackagesForVersion(version)
  const controller = new AbortController()
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal
  let firstFailure: unknown
  try {
    await Promise.all(
      packages.map(async name => {
        try {
          await waitForNpmVersion(name, version, {
            ...options,
            signal,
          })
        } catch (error) {
          firstFailure ??= error
          controller.abort(error)
          throw error
        }
      }),
    )
  } catch (error) {
    throw firstFailure ?? error
  }
  return packages
}

async function main(args = process.argv.slice(2)): Promise<void> {
  const version = args[0]
  if (args.length !== 1 || !version) {
    throw new Error('Usage: node scripts/release/availability.mts <version>')
  }
  const packages = await waitForReleasePackages(version)
  process.stdout.write(
    `npm exposes ${packages.map(name => `${name}@${version}`).join(', ')}.\n`,
  )
}

if (isMainModule(import.meta.url)) {
  runMain(main, {
    describe: 'Waits for every package in a release to become public on npm.',
    help: 'Usage: node scripts/release/availability.mts <version>',
  })
}
