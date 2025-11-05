/**
 * TypeScript availability and type system checks.
 */

// TypeScript types/libs availability.
export function getTsTypesAvailable(): boolean {
  try {
    require.resolve('typescript/lib/lib.d.ts')
    return true
  } catch {
    return false
  }
}

export function getTsLibsAvailable(): boolean {
  try {
    require.resolve('typescript/lib')
    return true
  } catch {
    return false
  }
}
