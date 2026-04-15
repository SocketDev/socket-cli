/**
 * @fileoverview Type declarations for @babel/traverse module.
 */

declare module '@babel/traverse' {
  import type { File } from '@babel/types'

  interface NodePath<T = any> {
    node: T
  }

  interface TraverseOptions {
    [key: string]: ((path: NodePath) => void) | undefined
  }

  function traverse(ast: File, opts: TraverseOptions): void

  export default traverse
}
