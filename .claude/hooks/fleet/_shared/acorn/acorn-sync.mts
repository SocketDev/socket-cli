/**
 * Sync WASM loader (ESM).
 *
 * Re-exports the @ultrathink/acorn.wasm parser API. The package's CJS entry is
 * wasm-bindgen glue that instantiates its WASM synchronously at require.
 *
 * The instantiation is LAZY (first call), NOT at module eval: a V8 startup
 * snapshot build pass evaluates every module but has no `WebAssembly` global,
 * so instantiating at import throws `ReferenceError: WebAssembly is not
 * defined` during `node --build-snapshot`. Deferring to first use keeps module
 * eval pure (snapshot-safe); the WASM is built at runtime, where `WebAssembly`
 * exists.
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

interface AcornWasm {
  aqs_match: (source: string, selector: string) => string
  countNodes: (code: string, options_js: any) => number
  findNodeAfter: (
    code: string,
    pos: number,
    node_type: string | null | undefined,
    options_js: any,
  ) => any
  findNodeAround: (
    code: string,
    pos: number,
    node_type: string | null | undefined,
    options_js: any,
  ) => any
  findNodeAt: (
    code: string,
    start: number,
    end: number | null | undefined,
    node_type: string | null | undefined,
    options_js: any,
  ) => any
  findNodeBefore: (
    code: string,
    pos: number,
    node_type: string | null | undefined,
    options_js: any,
  ) => any
  full: (code: string, visitors_obj: any, options_js: any) => void
  fullAncestor: (code: string, visitors_obj: any, options_js: any) => void
  is_valid: (code: string) => boolean
  parse: (code: string, options: any) => any
  recursive: (code: string, state: any, funcs: any, options_js: any) => void
  simple: (code: string, visitors_obj: any, options_js: any) => void
  version: () => string
  walk: (code: string, visitors_obj: any, options_js: any) => void
}

let cached: AcornWasm | undefined

// Instantiate on first use so the WASM is never touched during a snapshot build
// pass (module eval). Runtime-only → `WebAssembly` is present.
function wasm(): AcornWasm {
  if (cached === undefined) {
    cached = require('@ultrathink/acorn.wasm') as AcornWasm
  }
  return cached
}

export function aqs_match(source: string, selector: string): string {
  return wasm().aqs_match(source, selector)
}

export function countNodes(code: string, options_js: any): number {
  return wasm().countNodes(code, options_js)
}

export function findNodeAfter(
  code: string,
  pos: number,
  node_type: string | null | undefined,
  options_js: any,
): any {
  return wasm().findNodeAfter(code, pos, node_type, options_js)
}

export function findNodeAround(
  code: string,
  pos: number,
  node_type: string | null | undefined,
  options_js: any,
): any {
  return wasm().findNodeAround(code, pos, node_type, options_js)
}

export function findNodeAt(
  code: string,
  start: number,
  end: number | null | undefined,
  node_type: string | null | undefined,
  options_js: any,
): any {
  return wasm().findNodeAt(code, start, end, node_type, options_js)
}

export function findNodeBefore(
  code: string,
  pos: number,
  node_type: string | null | undefined,
  options_js: any,
): any {
  return wasm().findNodeBefore(code, pos, node_type, options_js)
}

export function full(code: string, visitors_obj: any, options_js: any): void {
  wasm().full(code, visitors_obj, options_js)
}

export function fullAncestor(
  code: string,
  visitors_obj: any,
  options_js: any,
): void {
  wasm().fullAncestor(code, visitors_obj, options_js)
}

export function is_valid(code: string): boolean {
  return wasm().is_valid(code)
}

export function parse(code: string, options: any): any {
  return wasm().parse(code, options)
}

export function recursive(
  code: string,
  state: any,
  funcs: any,
  options_js: any,
): void {
  wasm().recursive(code, state, funcs, options_js)
}

export function simple(code: string, visitors_obj: any, options_js: any): void {
  wasm().simple(code, visitors_obj, options_js)
}

export function version(): string {
  return wasm().version()
}

export function walk(code: string, visitors_obj: any, options_js: any): void {
  wasm().walk(code, visitors_obj, options_js)
}
