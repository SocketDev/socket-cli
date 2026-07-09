/**
 * @file Minimal structural types for the subset of the Babel AST and plugin
 *   API used by the babel-plugin-*.mts transforms in this directory.
 *   `@babel/core` ships no type declarations for this repo's install, so
 *   these interfaces model only the node shapes and `t` (babel types)
 *   methods each transform actually touches.
 */

export interface BabelNode {
  type: string
}

export interface BabelIdentifier extends BabelNode {
  type: 'Identifier'
  name: string
}

export interface BabelLiteral extends BabelNode {
  value: string | number | boolean | null
}

export interface BabelMemberExpression extends BabelNode {
  type: 'MemberExpression'
  computed: boolean
  object: BabelNode
  property: BabelNode
}

export interface BabelObjectProperty extends BabelNode {
  type: 'ObjectProperty'
  key: BabelNode
  value: BabelNode
}

export interface BabelObjectExpression extends BabelNode {
  type: 'ObjectExpression'
  properties: BabelNode[]
}

export interface BabelVariableDeclarator extends BabelNode {
  type: 'VariableDeclarator'
  id: BabelNode
  init: BabelNode | null
}

export interface BabelVariableDeclaration extends BabelNode {
  type: 'VariableDeclaration'
  declarations: BabelVariableDeclarator[]
}

export interface BabelLogicalExpression extends BabelNode {
  type: 'LogicalExpression'
  left: BabelNode
  operator: string
  right: BabelNode
}

export interface BabelAssignmentExpression extends BabelNode {
  type: 'AssignmentExpression'
  left: BabelNode
  right: BabelNode
}

export interface BabelConditionalExpression extends BabelNode {
  type: 'ConditionalExpression'
  alternate: BabelNode
  consequent: BabelNode
  test: BabelNode
}

export interface BabelCallExpression extends BabelNode {
  type: 'CallExpression'
  arguments: BabelNode[]
  callee: BabelNode
}

export interface BabelExpressionStatement extends BabelNode {
  type: 'ExpressionStatement'
  expression: BabelNode
}

export interface BabelIfStatement extends BabelNode {
  type: 'IfStatement'
  test: BabelNode
}

/**
 * Minimal shape of a Babel `NodePath` used by these plugins.
 */
export interface BabelPath<T extends BabelNode = BabelNode> {
  node: T
  parent: BabelNode
  parentPath: BabelPath
  isExpressionStatement(): boolean
  remove(): void
  replaceWith(node: BabelNode): void
}

/**
 * Minimal shape of the `t` (babel types) namespace used by these plugins.
 */
export interface BabelTypes {
  booleanLiteral(value: boolean): BabelNode
  callExpression(callee: BabelNode, args: BabelNode[]): BabelCallExpression
  expressionStatement(expression: BabelNode): BabelExpressionStatement
  identifier(name: string): BabelIdentifier
  isAssignmentExpression(
    node: BabelNode | null | undefined,
  ): node is BabelAssignmentExpression
  isBooleanLiteral(node: BabelNode | null | undefined): boolean
  isIdentifier(
    node: BabelNode | null | undefined,
    opts?: { name?: string | undefined },
  ): node is BabelIdentifier
  isLogicalExpression(
    node: BabelNode | null | undefined,
    opts?: { operator?: string | undefined },
  ): node is BabelLogicalExpression
  isMemberExpression(
    node: BabelNode | null | undefined,
  ): node is BabelMemberExpression
  isNullLiteral(node: BabelNode | null | undefined): boolean
  isNumericLiteral(node: BabelNode | null | undefined): boolean
  isObjectExpression(
    node: BabelNode | null | undefined,
  ): node is BabelObjectExpression
  isObjectProperty(
    node: BabelNode | null | undefined,
  ): node is BabelObjectProperty
  isStringLiteral(node: BabelNode | null | undefined): boolean
  isVariableDeclarator(
    node: BabelNode | null | undefined,
  ): node is BabelVariableDeclarator
  memberExpression(
    object: BabelNode,
    property: BabelNode,
    computed?: boolean,
  ): BabelMemberExpression
  newExpression(callee: BabelNode, args: BabelNode[]): BabelNode
  nullLiteral(): BabelNode
  numericLiteral(value: number): BabelNode
  stringLiteral(value: string): BabelNode
}

export interface BabelApi {
  types: BabelTypes
}
