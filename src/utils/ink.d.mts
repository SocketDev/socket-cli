/**
 * @fileoverview Type definitions for Ink wrapper.
 */

/* eslint-disable */

import type { Box as InkBox, Text as InkText, render as inkRender } from 'ink'
import type ReactImport from 'react'
import type InkTableImport from '../external/ink-table.mjs'

export const Box: typeof InkBox
export const Text: typeof InkText
export const render: typeof inkRender
export const React: typeof ReactImport
export const InkTable: typeof InkTableImport

export type { BoxProps, TextProps } from 'ink'
export type { default as ReactType } from 'react'
