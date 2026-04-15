/**
 * @fileoverview React reconciler for OpenTUI terminal UI.
 *
 * Provides a React renderer that maps JSX components to the OpenTUI
 * render engine's Element tree format. Uses react-reconciler to bridge
 * React's component model to our yoga-layout + opentui.node pipeline.
 *
 * Usage:
 *   import { render, Box, Text } from '@socketaddon/opentui/react'
 *
 *   render(
 *     <Box borderStyle="single" padding={1}>
 *       <Text color="green" bold>Hello from React!</Text>
 *     </Box>
 *   )
 */

import { createRequire } from 'node:module'
import process from 'node:process'

const require = createRequire(import.meta.url)

const Reconciler = require('react-reconciler')

// ---------------------------------------------------------------------------
// Element tree node (same shape as render-engine.mjs expects)
// ---------------------------------------------------------------------------

function createElementNode(type, props) {
  const node = { type, children: [] }

  if (type === 'Text') {
    // Text content comes from children prop.
    if (typeof props.children === 'string') {
      node.content = props.children
    } else if (Array.isArray(props.children)) {
      node.content = props.children.join('')
    }
    // Style props.
    if (props.color) node.color = props.color
    if (props.bold) node.bold = true
    if (props.dimColor) node.dim_color = true
    if (props.italic) node.italic = true
    if (props.underline) node.underline = true
    if (props.strikethrough) node.strikethrough = true
    if (props.weight) node.weight = props.weight
    if (props.align) node.align = props.align
    if (props.wrap) node.wrap = props.wrap
  } else if (type === 'View') {
    // Layout props → snake_case for render engine.
    if (props.flexDirection) node.flex_direction = props.flexDirection
    if (props.justifyContent) node.justify_content = props.justifyContent
    if (props.alignItems) node.align_items = props.alignItems
    if (props.alignContent) node.align_content = props.alignContent
    if (props.flexGrow !== undefined) node.flex_grow = props.flexGrow
    if (props.flexShrink !== undefined) node.flex_shrink = props.flexShrink
    if (props.flexBasis !== undefined) node.flex_basis = props.flexBasis
    if (props.flexWrap) node.flex_wrap = props.flexWrap
    if (props.gap !== undefined) node.gap = props.gap
    if (props.rowGap !== undefined) node.row_gap = props.rowGap
    if (props.columnGap !== undefined) node.column_gap = props.columnGap
    if (props.width !== undefined) node.width = props.width
    if (props.height !== undefined) node.height = props.height
    if (props.minWidth !== undefined) node.min_width = props.minWidth
    if (props.minHeight !== undefined) node.min_height = props.minHeight
    if (props.maxWidth !== undefined) node.max_width = props.maxWidth
    if (props.maxHeight !== undefined) node.max_height = props.maxHeight
    if (props.padding !== undefined) node.padding = props.padding
    if (props.paddingX !== undefined) node.padding_x = props.paddingX
    if (props.paddingY !== undefined) node.padding_y = props.paddingY
    if (props.paddingTop !== undefined) node.padding_top = props.paddingTop
    if (props.paddingRight !== undefined) node.padding_right = props.paddingRight
    if (props.paddingBottom !== undefined) node.padding_bottom = props.paddingBottom
    if (props.paddingLeft !== undefined) node.padding_left = props.paddingLeft
    if (props.margin !== undefined) node.margin = props.margin
    if (props.marginX !== undefined) node.margin_x = props.marginX
    if (props.marginY !== undefined) node.margin_y = props.marginY
    if (props.marginTop !== undefined) node.margin_top = props.marginTop
    if (props.marginRight !== undefined) node.margin_right = props.marginRight
    if (props.marginBottom !== undefined) node.margin_bottom = props.marginBottom
    if (props.marginLeft !== undefined) node.margin_left = props.marginLeft
    if (props.borderStyle) node.border_style = props.borderStyle
    if (props.borderColor) node.border_color = props.borderColor
    if (props.borderEdges) node.border_edges = props.borderEdges
    if (props.backgroundColor) node.background_color = props.backgroundColor
    if (props.display) node.display = props.display
    if (props.position) node.position = props.position
    if (props.top !== undefined) node.top = props.top
    if (props.right !== undefined) node.right = props.right
    if (props.bottom !== undefined) node.bottom = props.bottom
    if (props.left !== undefined) node.left = props.left
    if (props.inset !== undefined) node.inset = props.inset
    if (props.overflow) {
      node.overflow_x = props.overflow
      node.overflow_y = props.overflow
    }
    if (props.overflowX) node.overflow_x = props.overflowX
    if (props.overflowY) node.overflow_y = props.overflowY
  } else if (type === 'MixedText') {
    if (props.contents) {
      node.mixed_text_contents = props.contents.map(s => ({
        text: s.text,
        color: s.color,
        weight: s.weight,
        decoration: s.decoration,
        italic: s.italic,
      }))
    }
    if (props.align) node.align = props.align
    if (props.wrap) node.wrap = props.wrap
  }

  return node
}

// ---------------------------------------------------------------------------
// React reconciler host config
// ---------------------------------------------------------------------------

// Map JSX element types to internal types.
const TYPE_MAP = {
  __proto__: null,
  box: 'View',
  text: 'Text',
  'mixed-text': 'MixedText',
  br: 'Text', // line break → newline text node
}

const hostConfig = {
  // Core
  createInstance(type, props) {
    const internalType = TYPE_MAP[type] || type
    const node = createElementNode(internalType, props)
    // Handle <br> as newline.
    if (type === 'br') {
      node.content = '\n'
    }
    return node
  },

  createTextInstance(text) {
    return { type: 'Text', content: text, children: [] }
  },

  appendChildToContainer(container, child) {
    container.children.push(child)
  },

  appendChild(parent, child) {
    parent.children.push(child)
  },

  appendInitialChild(parent, child) {
    parent.children.push(child)
  },

  removeChild(parent, child) {
    const idx = parent.children.indexOf(child)
    if (idx !== -1) parent.children.splice(idx, 1)
  },

  removeChildFromContainer(container, child) {
    const idx = container.children.indexOf(child)
    if (idx !== -1) container.children.splice(idx, 1)
  },

  insertBefore(parent, child, before) {
    const idx = parent.children.indexOf(before)
    if (idx !== -1) {
      parent.children.splice(idx, 0, child)
    } else {
      parent.children.push(child)
    }
  },

  insertInContainerBefore(container, child, before) {
    const idx = container.children.indexOf(before)
    if (idx !== -1) {
      container.children.splice(idx, 0, child)
    } else {
      container.children.push(child)
    }
  },

  // Updates
  prepareUpdate(_instance, _type, _oldProps, _newProps) {
    return true // Always update for now.
  },

  commitUpdate(instance, _payload, type, _oldProps, newProps) {
    // Rebuild the node with new props.
    const internalType = TYPE_MAP[type] || type
    const updated = createElementNode(internalType, newProps)
    Object.assign(instance, updated)
    instance.children = instance.children || []
  },

  commitTextUpdate(node, _oldText, newText) {
    node.content = newText
  },

  // Tree operations
  getRootHostContext() {
    return {}
  },

  getChildHostContext(parentContext) {
    return parentContext
  },

  getPublicInstance(instance) {
    return instance
  },

  finalizeInitialChildren() {
    return false
  },

  prepareForCommit() {
    return null
  },

  resetAfterCommit() {},

  shouldSetTextContent(_type, props) {
    return typeof props.children === 'string'
  },

  clearContainer(container) {
    container.children = []
  },

  // Required but no-op for static rendering.
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: true,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  getCurrentEventPriority() {
    return 16 // DefaultEventPriority
  },
  getInstanceFromNode() {
    return null
  },
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
  prepareScopeUpdate() {},
  getInstanceFromScope() {
    return null
  },
  detachDeletedInstance() {},
  preparePortalMount() {},
  setCurrentUpdatePriority() {},
  getCurrentUpdatePriority() {
    return 16
  },
  resolveUpdatePriority() {
    return 16
  },
  resetFormInstance() {},
  requestPostPaintCallback() {},
  maySuspendCommit() {
    return false
  },
  preloadInstance() {
    return true
  },
  completeSuspendedInstance() {},
  resolveEventType() {
    return null
  },
  resolveEventTimeStamp() {
    return 0
  },
  shouldAttemptEagerTransition() {
    return false
  },
  trackSchedulerEvent() {},
  resolveUpdatePriority() {
    return 16
  },
  setCurrentUpdatePriority() {},
  getCurrentUpdatePriority() {
    return 16
  },
  NotPendingTransition: null,
}

const reconciler = Reconciler(hostConfig)

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a React element tree to an Element node tree suitable for
 * the OpenTUI render engine.
 *
 * @param {import('react').ReactElement} element - React element to render
 * @returns {object} Element tree (View with children)
 */
export function renderToElementTree(element) {
  const container = { type: 'View', children: [] }
  const root = reconciler.createContainer(
    container,
    0, // LegacyRoot — synchronous rendering
    null,
    false,
    null,
    '',
    () => {},
    null,
  )
  // Synchronous render: updateContainerSync + flushSyncWork ensures
  // the tree is fully built before we return.
  reconciler.updateContainerSync(element, root, null, () => {})
  reconciler.flushSyncWork()
  // If single child, return it directly.
  if (container.children.length === 1) {
    return container.children[0]
  }
  return container
}

/**
 * Render a React element to stdout using the OpenTUI render engine.
 *
 * @param {import('react').ReactElement} element - React element
 * @param {object} engine - OpenTUI render engine instance
 */
export function render(element, engine) {
  const tree = renderToElementTree(element)
  engine.printComponent(tree)
}

/**
 * Render a React element to a plain text string.
 *
 * @param {import('react').ReactElement} element - React element
 * @param {object} engine - OpenTUI render engine instance
 * @returns {string} Plain text output
 */
export function renderToString(element, engine) {
  const tree = renderToElementTree(element)
  return engine.renderToString(tree)
}

// Re-export React.createElement for JSX usage without React import.
export { createElement } from 'react'
