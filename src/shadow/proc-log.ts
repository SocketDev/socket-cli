import path from 'node:path'

import { npmNmPath } from './npm-paths'
import constants from '../constants'

const { UNDEFINED_TOKEN } = constants

interface RequireKnownModules {
  npmlog: typeof import('npmlog')
  // The DefinitelyTyped definition of 'proc-log' does NOT have the log method.
  // The return type of the log method is the same as `typeof import('proc-log')`.
  'proc-log': typeof import('proc-log')
}

type RequireTransformer<T extends keyof RequireKnownModules> = (
  mod: RequireKnownModules[T]
) => RequireKnownModules[T]

function tryRequire<T extends keyof RequireKnownModules>(
  ...ids: (T | [T, RequireTransformer<T>])[]
): RequireKnownModules[T] | undefined {
  for (const data of ids) {
    let id: string | undefined
    let transformer: RequireTransformer<T> | undefined
    if (Array.isArray(data)) {
      id = data[0]
      transformer = <RequireTransformer<T>>data[1]
    } else {
      id = <keyof RequireKnownModules>data
      transformer = mod => mod
    }
    try {
      // Check that the transformed value isn't `undefined` because older
      // versions of packages like 'proc-log' may not export a `log` method.
      const exported = transformer(require(id))
      if (exported !== undefined) {
        return exported
      }
    } catch {}
  }
  return undefined
}

type GetLoggerReturnType =
  | typeof import('npmlog')
  | typeof import('proc-log')
  | undefined

let _log: GetLoggerReturnType | {} = UNDEFINED_TOKEN
export function getLogger(): GetLoggerReturnType {
  if (_log === UNDEFINED_TOKEN) {
    _log = tryRequire(
      [
        <'proc-log'>path.join(npmNmPath, 'proc-log/lib/index.js'),
        // The proc-log DefinitelyTyped definition is incorrect. The type definition
        // is really that of its export log.
        mod => <RequireKnownModules['proc-log']>(mod as any).log
      ],
      <'npmlog'>path.join(npmNmPath, 'npmlog/lib/log.js')
    )
  }
  return <GetLoggerReturnType>_log
}
