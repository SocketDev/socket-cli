/**
 * Sync external WASM loader (ESM).
 *
 * Reads `./acorn.wasm` from disk synchronously at module-load time via
 * fs.readFileSync + new WebAssembly.Module + new WebAssembly.Instance. No async
 * init, no top-level await.
 *
 * Pairs with acorn.wasm in the same directory.
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const wasm = require('./acorn-bindgen.cjs')

export const aqs_match: (source: string, selector: string) => string =
  wasm.aqs_match
export const countNodes: (code: string, options_js: any) => number =
  wasm.countNodes
export const findNodeAfter: (
  code: string,
  pos: number,
  node_type: string | null | undefined,
  options_js: any,
) => any = wasm.findNodeAfter
export const findNodeAround: (
  code: string,
  pos: number,
  node_type: string | null | undefined,
  options_js: any,
) => any = wasm.findNodeAround
export const findNodeAt: (
  code: string,
  start: number,
  end: number | null | undefined,
  node_type: string | null | undefined,
  options_js: any,
) => any = wasm.findNodeAt
export const findNodeBefore: (
  code: string,
  pos: number,
  node_type: string | null | undefined,
  options_js: any,
) => any = wasm.findNodeBefore
export const full: (code: string, visitors_obj: any, options_js: any) => void =
  wasm.full
export const fullAncestor: (
  code: string,
  visitors_obj: any,
  options_js: any,
) => void = wasm.fullAncestor
export const is_valid: (code: string) => boolean = wasm.is_valid
export const parse: (code: string, options: any) => any = wasm.parse
export const recursive: (
  code: string,
  state: any,
  funcs: any,
  options_js: any,
) => void = wasm.recursive
export const simple: (
  code: string,
  visitors_obj: any,
  options_js: any,
) => void = wasm.simple
export const version: () => string = wasm.version
export const walk: (code: string, visitors_obj: any, options_js: any) => void =
  wasm.walk
