/**
 * @fileoverview Type definitions for Ink wrapper.
 */

/* eslint-disable */

import type { Box as InkBox, Text as InkText, render as inkRender } from 'ink'
import type ReactImport from 'react'
import type InkTableImport from '../external/ink-table.mjs'

export declare const Box: typeof InkBox
export declare const Text: typeof InkText
export declare const render: typeof inkRender
export declare const React: typeof ReactImport
export declare const InkTable: typeof InkTableImport

export type { BoxProps, TextProps } from 'ink'
export type { default as ReactType } from 'react'
