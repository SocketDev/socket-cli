import { isIP } from 'node:net'

export type FirewallErrorDiagnostic = {
  name: string
  code?: string | undefined
  address?: string | undefined
  port?: number | undefined
}

export function collectFirewallErrorDiagnostics(
  error: unknown,
): FirewallErrorDiagnostic[] {
  const pending = [error]
  const seen = new Set<unknown>()
  const diagnostics: FirewallErrorDiagnostic[] = []
  while (pending.length && seen.size < 64) {
    const current = pending.shift()
    if (seen.has(current)) {
      continue
    }
    seen.add(current)
    if (!(current instanceof Error)) {
      diagnostics.push({ name: 'UnknownError' })
      continue
    }
    diagnostics.push(readFirewallErrorDiagnostic(current))
    if (current instanceof AggregateError) {
      const nested = Object.getOwnPropertyDescriptor(current, 'errors')
        ?.value as unknown
      if (Array.isArray(nested)) {
        pending.push(...nested.slice(0, 64 - seen.size))
      }
    }
    const cause = Object.getOwnPropertyDescriptor(current, 'cause')
      ?.value as unknown
    if (cause !== undefined) {
      pending.push(cause)
    }
  }
  return diagnostics
}

export function formatFirewallError(error: unknown): string {
  return collectFirewallErrorDiagnostics(error)
    .map(diagnostic => {
      const address = diagnostic.address?.includes(':')
        ? `[${diagnostic.address}]`
        : diagnostic.address
      const destination = address
        ? `${address}${diagnostic.port ? `:${diagnostic.port}` : ''}`
        : ''
      return [diagnostic.code ?? diagnostic.name, destination]
        .filter(Boolean)
        .join(' ')
    })
    .join('; ')
}

export function readFirewallErrorDiagnostic(
  error: Error,
): FirewallErrorDiagnostic {
  const code = Object.getOwnPropertyDescriptor(error, 'code')?.value as unknown
  const address = Object.getOwnPropertyDescriptor(error, 'address')
    ?.value as unknown
  const port = Object.getOwnPropertyDescriptor(error, 'port')?.value as unknown
  return {
    name: error instanceof AggregateError ? 'AggregateError' : 'Error',
    ...(typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)
      ? { code }
      : {}),
    ...(typeof address === 'string' && isIP(address) ? { address } : {}),
    ...(typeof port === 'number' &&
    Number.isInteger(port) &&
    port > 0 &&
    port <= 65_535
      ? { port }
      : {}),
  }
}
