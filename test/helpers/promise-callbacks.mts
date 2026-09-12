import { setImmediate } from 'node:timers'

export async function settlePromiseCallbacks(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve))
}
