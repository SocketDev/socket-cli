/**
 * @fileoverview Type definitions for ink-table wrapper.
 */

/* eslint-disable no-undef */

import type React from 'react'

type Scalar = string | number | boolean | null | undefined

type ScalarDict = {
  [key: string]: Scalar
}

export type CellProps = React.PropsWithChildren<{
  column: number
}>

export type TableProps<T extends ScalarDict> = {
  data: T[]
  columns: Array<keyof T>
  padding: number
  header: (props: React.PropsWithChildren<{}>) => JSX.Element
  cell: (props: CellProps) => JSX.Element
  skeleton: (props: React.PropsWithChildren<{}>) => JSX.Element
}

export default class Table<T extends ScalarDict> extends React.Component<
  Pick<TableProps<T>, 'data'> & Partial<TableProps<T>>
> {}

export function Header(props: React.PropsWithChildren<{}>): JSX.Element
export function Cell(props: CellProps): JSX.Element
export function Skeleton(props: React.PropsWithChildren<{}>): JSX.Element
