/**
 * @fileoverview Ink and React re-exports with tsgo workaround.
 *
 * tsx files are treated as CommonJS by tsgo without package.json type:module.
 * This wrapper centralizes the @ts-ignore directives needed for tsx imports.
 */

// @ts-ignore - tsx files treated as CJS by tsgo without package.json type:module
import { Box as InkBox, Text as InkText, render as inkRender } from 'ink'
// @ts-ignore - tsx files treated as CJS by tsgo without package.json type:module
import ReactImport from 'react'

// @ts-ignore - tsx files treated as CJS by tsgo without package.json type:module
import InkTableImport from '../external/ink-table.mjs'

import type { FC } from 'react'

export const Box: typeof InkBox = InkBox
export const Text: typeof InkText = InkText
export const render: typeof inkRender = inkRender
export const React: typeof ReactImport = ReactImport
export const InkTable: typeof InkTableImport = InkTableImport

// @ts-ignore - tsx files treated as CJS by tsgo without package.json type:module.
export type { BoxProps, TextProps } from 'ink'
export type { FC }
export type Element = ReturnType<FC>
