/**
 * @file Minimal structural types for the Babel AST/API surface the
 *   `--with-intl=none` plugin touches. `@babel/core` ships no type
 *   declarations in this repo, so these are hand-rolled — narrow on purpose,
 *   covering only the fields/methods that plugin reads or calls.
 */

/**
 * Minimal Babel AST node shape — only the fields this plugin reads.
 */
export interface BabelNode {
  type: string
}

export interface BabelIdentifierNode extends BabelNode {
  name: string
  type: 'Identifier'
}

export interface BabelMemberExpressionNode extends BabelNode {
  object: BabelNode
  property: BabelNode & { name?: string | undefined }
  type: 'MemberExpression'
}

export interface BabelCallExpressionNode extends BabelNode {
  arguments: BabelNode[]
  callee: BabelNode
  type: 'CallExpression'
}

export interface BabelNewExpressionNode extends BabelNode {
  callee: BabelNode
  type: 'NewExpression'
}

export interface BabelNumericLiteralNode extends BabelNode {
  type: 'NumericLiteral'
  value: number
}

export interface BabelRegExpLiteralNode extends BabelNode {
  flags: string
  pattern: string
  type: 'RegExpLiteral'
}

export interface BabelProgramNode extends BabelNode {
  body: BabelNode[]
  type: 'Program'
}

/**
 * Minimal Babel `types` (`t`) surface this plugin uses.
 */
export interface BabelTypes {
  blockStatement(body: BabelNode[]): BabelNode
  callExpression(callee: BabelNode, args: BabelNode[]): BabelCallExpressionNode
  identifier(name: string): BabelIdentifierNode
  isIdentifier(
    node: BabelNode | null | undefined,
    opts?: { name: string } | undefined,
  ): node is BabelIdentifierNode
  isMemberExpression(
    node: BabelNode | null | undefined,
  ): node is BabelMemberExpressionNode
  isNewExpression(
    node: BabelNode | null | undefined,
  ): node is BabelNewExpressionNode
  isNumericLiteral(
    node: BabelNode | null | undefined,
  ): node is BabelNumericLiteralNode
  memberExpression(
    object: BabelNode,
    property: BabelNode,
    computed?: boolean | undefined,
  ): BabelMemberExpressionNode
  numericLiteral(value: number): BabelNode
  objectExpression(properties: BabelNode[]): BabelNode
  objectMethod(
    kind: 'method' | 'get' | 'set',
    key: BabelNode,
    params: BabelNode[],
    body: BabelNode,
  ): BabelNode
  regExpLiteral(pattern: string, flags: string): BabelRegExpLiteralNode
  returnStatement(argument: BabelNode): BabelNode
  stringLiteral(value: string): BabelNode
}

/**
 * Minimal Babel `NodePath` surface this plugin uses.
 */
export interface BabelPath<T extends BabelNode = BabelNode> {
  addComment(position: 'leading' | 'trailing' | 'inner', comment: string): void
  findParent(
    predicate: (path: BabelPath) => boolean,
  ): BabelPath<BabelProgramNode> | undefined
  get(key: string): BabelPath
  isProgram(): boolean
  node: T
  replaceWith(node: BabelNode): void
}

/**
 * Minimal Babel `template` API surface this plugin uses.
 */
export interface BabelTemplateApi {
  ast(code: string): BabelNode
}

/**
 * Name of one of the injected runtime formatting/comparison helpers.
 */
export type HelperName =
  | '__formatDate'
  | '__formatDateTime'
  | '__formatNumber'
  | '__simpleCompare'
