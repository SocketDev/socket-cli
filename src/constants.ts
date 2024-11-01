import pacote from 'pacote'

function envAsBoolean(value: any): boolean {
  return (
    typeof value === 'string' &&
    (value === '1' || value.toLowerCase() === 'true')
  )
}

export const API_V0_URL = 'https://api.socket.dev/v0'

export const ENV = Object.freeze({
  // Flag set by the optimize command to bypass the packagesHaveRiskyIssues check.
  UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE: envAsBoolean(
    process.env['UPDATE_SOCKET_OVERRIDES_IN_PACKAGE_LOCK_FILE']
  )
})

export const packumentCache = new Map()

const { constructor: PacoteFetcherBase } = Reflect.getPrototypeOf(
  (pacote as any).RegistryFetcher.prototype
)!
export const pacoteCachePath = (
  new (PacoteFetcherBase as new (...args: any[]) => string)(
    /*dummy package spec*/ 'x',
    {}
  ) as any
).cache
