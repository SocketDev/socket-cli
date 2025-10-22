/**
 * @fileoverview Ink and React re-exports with tsgo workaround.
 *
 * tsx files are treated as CommonJS by tsgo without package.json type:module.
 * This wrapper centralizes the @ts-expect-error directives needed for tsx imports.
 */

import { Box as InkBox, Text as InkText, render as inkRender } from 'ink'
import ReactImport from 'react'

import InkTableImport from '../../external/ink-table.mjs'

import type { FC } from 'react'

export const Box: typeof InkBox = InkBox
export const Text: typeof InkText = InkText
export const render: typeof inkRender = inkRender
export const React: typeof ReactImport = ReactImport
export const InkTable: typeof InkTableImport = InkTableImport

export type { BoxProps, TextProps } from 'ink'
export type { FC }
export type Element = ReturnType<FC>
