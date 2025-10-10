/**
 * @fileoverview ink-table wrapper for proper ESM/CommonJS interop.
 *
 * ink-table is a CommonJS module that needs special handling with
 * verbatimModuleSyntax to work properly in TypeScript ESM.
 * tsx files are treated as CommonJS by tsgo without package.json type:module.
 */

// @ts-expect-error - tsx files treated as CJS by tsgo without package.json type:module
import InkTableCJS from 'ink-table'

export default InkTableCJS
export const { Cell, Header, Skeleton } = InkTableCJS
