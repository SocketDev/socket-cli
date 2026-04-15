/**
 * @fileoverview OpenTUI render engine with yoga-layout flexbox.
 *
 * Accepts the same Element tree that iocraft.mts produces and renders it
 * using yoga-layout for flexbox computation and opentui.node for buffer
 * drawing + ANSI output.
 *
 * Public API (iocraft-compatible):
 *   renderToString(element)    → string (ANSI)
 *   renderToStringWithWidth(element, maxWidth) → string
 *   printComponent(element)    → void (stdout)
 *   eprintComponent(element)   → void (stderr)
 *   getTerminalSize()          → [columns, rows]
 */

import { createRequire } from 'node:module'
import process from 'node:process'

const require = createRequire(import.meta.url)

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Strip terminal control sequences from getLastOutputForTest output,
// keeping only printable text and ANSI SGR (color/style) codes.
// This makes renderToString output compatible with iocraft's cleaner format.
// eslint-disable-next-line no-control-regex
const CURSOR_CONTROL_RE = /\x1b\[\?[0-9;]*[a-zA-Z]|\x1b\[[0-9;]*[HJKfABCDEFGSTn]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9]+ q/g

function stripCursorControls(s) {
  return s.replace(CURSOR_CONTROL_RE, '')
}

const TEXT_ATTR_BOLD = 1
const TEXT_ATTR_DIM = 2
const TEXT_ATTR_ITALIC = 4
const TEXT_ATTR_UNDERLINE = 8
const TEXT_ATTR_STRIKETHROUGH = 128

const BLACK = new Float32Array([0, 0, 0, 1])
const WHITE = new Float32Array([1, 1, 1, 1])
const TRANSPARENT = new Float32Array([0, 0, 0, 0])

// Standard ANSI color names → RGBA floats.
const NAMED_COLORS = {
  __proto__: null,
  black: [0, 0, 0, 1],
  blue: [0, 0, 0.8, 1],
  blueBright: [0.33, 0.33, 1, 1],
  cyan: [0, 0.8, 0.8, 1],
  cyanBright: [0.33, 1, 1, 1],
  gray: [0.5, 0.5, 0.5, 1],
  green: [0, 0.8, 0, 1],
  greenBright: [0.33, 1, 0.33, 1],
  grey: [0.5, 0.5, 0.5, 1],
  magenta: [0.8, 0, 0.8, 1],
  magentaBright: [1, 0.33, 1, 1],
  red: [0.8, 0, 0, 1],
  redBright: [1, 0.33, 0.33, 1],
  white: [1, 1, 1, 1],
  yellow: [0.8, 0.8, 0, 1],
  yellowBright: [1, 1, 0.33, 1],
}

// Unicode box-drawing character sets for border styles.
const BORDER_CHARS = {
  __proto__: null,
  bold: '\u250F\u2501\u2513\u2503\u2517\u2501\u251B\u2503', // ┏━┓┃┗━┛┃ (tl,t,tr,r,bl,b,br,l)
  classic: '+-+|+-+|',
  double: '\u2554\u2550\u2557\u2551\u255A\u2550\u255D\u2551', // ╔═╗║╚═╝║
  'double-left-right': '\u2553\u2500\u2556\u2551\u2559\u2500\u255C\u2551', // ╓─╖║╙─╜║
  'double-top-bottom': '\u2552\u2550\u2555\u2502\u2558\u2550\u255B\u2502', // ╒═╕│╘═╛│
  rounded: '\u256D\u2500\u256E\u2502\u2570\u2500\u256F\u2502', // ╭─╮│╰─╯│
  single: '\u250C\u2500\u2510\u2502\u2514\u2500\u2518\u2502', // ┌─┐│└─┘│
}

// ANSI 256-color palette → RGB (first 16 standard colors).
const ANSI_STANDARD = [
  [0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0],
  [0, 0, 128], [128, 0, 128], [0, 128, 128], [192, 192, 192],
  [128, 128, 128], [255, 0, 0], [0, 255, 0], [255, 255, 0],
  [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
]

// ---------------------------------------------------------------------------
// Color parsing
// ---------------------------------------------------------------------------

const colorCache = new Map()

function parseColor(color) {
  if (!color) return null
  const cached = colorCache.get(color)
  if (cached) return cached

  let result
  const named = NAMED_COLORS[color]
  if (named) {
    result = new Float32Array(named)
  } else if (color.startsWith('#')) {
    result = hexToRgba(color)
  } else if (color.startsWith('ansi:')) {
    result = ansi256ToRgba(parseInt(color.slice(5), 10))
  } else if (/^\d+$/.test(color)) {
    result = ansi256ToRgba(parseInt(color, 10))
  } else {
    result = null
  }

  if (result) colorCache.set(color, result)
  return result
}

function hexToRgba(hex) {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16) / 255
  const g = parseInt(h.substring(2, 4), 16) / 255
  const b = parseInt(h.substring(4, 6), 16) / 255
  return new Float32Array([r, g, b, 1])
}

function ansi256ToRgba(n) {
  if (n < 0 || n > 255) return new Float32Array(WHITE)
  if (n < 16) {
    const c = ANSI_STANDARD[n]
    return new Float32Array([c[0] / 255, c[1] / 255, c[2] / 255, 1])
  }
  if (n < 232) {
    // 6x6x6 color cube.
    const idx = n - 16
    const r = Math.floor(idx / 36)
    const g = Math.floor((idx % 36) / 6)
    const b = idx % 6
    return new Float32Array([
      r ? (r * 40 + 55) / 255 : 0,
      g ? (g * 40 + 55) / 255 : 0,
      b ? (b * 40 + 55) / 255 : 0,
      1,
    ])
  }
  // Grayscale ramp.
  const v = (8 + (n - 232) * 10) / 255
  return new Float32Array([v, v, v, 1])
}

// ---------------------------------------------------------------------------
// Text attributes
// ---------------------------------------------------------------------------

function buildAttributes(element) {
  let attrs = 0
  if (element.bold || element.weight === 'bold') attrs |= TEXT_ATTR_BOLD
  if (element.dim_color || element.weight === 'light') attrs |= TEXT_ATTR_DIM
  if (element.italic) attrs |= TEXT_ATTR_ITALIC
  if (element.underline) attrs |= TEXT_ATTR_UNDERLINE
  if (element.strikethrough) attrs |= TEXT_ATTR_STRIKETHROUGH
  return attrs
}

function buildSectionAttributes(section) {
  let attrs = 0
  if (section.weight === 'bold') attrs |= TEXT_ATTR_BOLD
  if (section.weight === 'light') attrs |= TEXT_ATTR_DIM
  if (section.italic) attrs |= TEXT_ATTR_ITALIC
  if (section.decoration === 'underline') attrs |= TEXT_ATTR_UNDERLINE
  if (section.decoration === 'strikethrough') attrs |= TEXT_ATTR_STRIKETHROUGH
  return attrs
}

// ---------------------------------------------------------------------------
// Text measurement
// ---------------------------------------------------------------------------

function measureText(text) {
  if (!text) return { width: 0, height: 0 }
  const lines = text.split('\n')
  let maxWidth = 0
  for (let i = 0, len = lines.length; i < len; i += 1) {
    const w = lines[i].length
    if (w > maxWidth) maxWidth = w
  }
  return { width: maxWidth, height: lines.length }
}

function getMixedTextWidth(contents) {
  if (!contents) return 0
  let width = 0
  for (let i = 0, len = contents.length; i < len; i += 1) {
    width += (contents[i].text || '').length
  }
  return width
}

// ---------------------------------------------------------------------------
// Yoga tree builder
// ---------------------------------------------------------------------------

function buildYogaTree(element, yoga, parentBg) {
  if (!element) return null

  // Fragment: transparent wrapper — return children directly.
  if (element.type === 'Fragment') {
    return {
      children: (element.children || []).map(c => buildYogaTree(c, yoga, parentBg)).filter(Boolean),
      element,
      isFragment: true,
    }
  }

  const node = yoga.Node.create()
  const bg = parseColor(element.background_color) || parentBg || TRANSPARENT

  if (element.type === 'Text' || element.type === 'MixedText') {
    // Leaf node — measure text to determine dimensions.
    const textContent = element.type === 'Text'
      ? (element.content || '')
      : ''
    const mixedWidth = element.type === 'MixedText'
      ? getMixedTextWidth(element.mixed_text_contents)
      : 0

    node.setMeasureFunc((width, widthMode, _height, _heightMode) => {
      if (element.type === 'MixedText') {
        return { width: mixedWidth, height: 1 }
      }
      const measured = measureText(textContent)
      if (widthMode === yoga.MEASURE_MODE_AT_MOST && measured.width > width) {
        // Wrap text to fit.
        const wrappedHeight = Math.ceil(measured.width / Math.max(1, Math.floor(width)))
        return { width: Math.min(measured.width, Math.floor(width)), height: wrappedHeight }
      }
      return measured
    })

    return { bg, children: [], element, node }
  }

  // View node — apply all flex properties.
  if (element.display === 'none') node.setDisplay(yoga.DISPLAY_NONE)
  if (element.position === 'absolute') node.setPositionType(yoga.POSITION_TYPE_ABSOLUTE)

  // Flex direction (default: column).
  if (element.flex_direction === 'row') {
    node.setFlexDirection(yoga.FLEX_DIRECTION_ROW)
  } else {
    node.setFlexDirection(yoga.FLEX_DIRECTION_COLUMN)
  }

  // Justify content.
  const justifyMap = {
    __proto__: null,
    center: yoga.JUSTIFY_CENTER,
    'flex-end': yoga.JUSTIFY_FLEX_END,
    'flex-start': yoga.JUSTIFY_FLEX_START,
    'space-around': yoga.JUSTIFY_SPACE_AROUND,
    'space-between': yoga.JUSTIFY_SPACE_BETWEEN,
  }
  if (element.justify_content && justifyMap[element.justify_content] !== undefined) {
    node.setJustifyContent(justifyMap[element.justify_content])
  }

  // Align items.
  const alignMap = {
    __proto__: null,
    center: yoga.ALIGN_CENTER,
    'flex-end': yoga.ALIGN_FLEX_END,
    'flex-start': yoga.ALIGN_FLEX_START,
    stretch: yoga.ALIGN_STRETCH,
  }
  if (element.align_items && alignMap[element.align_items] !== undefined) {
    node.setAlignItems(alignMap[element.align_items])
  }

  // Align content.
  const alignContentMap = {
    __proto__: null,
    center: yoga.ALIGN_CENTER,
    'flex-end': yoga.ALIGN_FLEX_END,
    'flex-start': yoga.ALIGN_FLEX_START,
    'space-around': yoga.ALIGN_SPACE_AROUND,
    'space-between': yoga.ALIGN_SPACE_BETWEEN,
    stretch: yoga.ALIGN_STRETCH,
  }
  if (element.align_content && alignContentMap[element.align_content] !== undefined) {
    node.setAlignContent(alignContentMap[element.align_content])
  }

  // Flex properties.
  if (element.flex_grow !== undefined) node.setFlexGrow(element.flex_grow)
  if (element.flex_shrink !== undefined) node.setFlexShrink(element.flex_shrink)
  if (element.flex_basis !== undefined) {
    if (element.flex_basis === 'auto') {
      node.setFlexBasisAuto()
    } else if (typeof element.flex_basis === 'string' && element.flex_basis.endsWith('%')) {
      node.setFlexBasisPercent(parseFloat(element.flex_basis))
    } else {
      node.setFlexBasis(element.flex_basis)
    }
  }
  if (element.flex_wrap === 'wrap') node.setFlexWrap(yoga.WRAP_WRAP)

  // Dimensions.
  if (element.width !== undefined) node.setWidth(element.width)
  if (element.height !== undefined) node.setHeight(element.height)
  if (element.min_width !== undefined) node.setMinWidth(element.min_width)
  if (element.min_height !== undefined) node.setMinHeight(element.min_height)
  if (element.max_width !== undefined) node.setMaxWidth(element.max_width)
  if (element.max_height !== undefined) node.setMaxHeight(element.max_height)

  // Gap.
  if (element.gap !== undefined) node.setGap(yoga.GUTTER_ALL, element.gap)
  if (element.row_gap !== undefined) node.setGap(yoga.GUTTER_ROW, element.row_gap)
  if (element.column_gap !== undefined) node.setGap(yoga.GUTTER_COLUMN, element.column_gap)

  // Padding.
  if (element.padding !== undefined) node.setPadding(yoga.EDGE_ALL, element.padding)
  if (element.padding_x !== undefined) node.setPadding(yoga.EDGE_HORIZONTAL, element.padding_x)
  if (element.padding_y !== undefined) node.setPadding(yoga.EDGE_VERTICAL, element.padding_y)
  if (element.padding_top !== undefined) node.setPadding(yoga.EDGE_TOP, element.padding_top)
  if (element.padding_right !== undefined) node.setPadding(yoga.EDGE_RIGHT, element.padding_right)
  if (element.padding_bottom !== undefined) node.setPadding(yoga.EDGE_BOTTOM, element.padding_bottom)
  if (element.padding_left !== undefined) node.setPadding(yoga.EDGE_LEFT, element.padding_left)

  // Margin.
  if (element.margin !== undefined) node.setMargin(yoga.EDGE_ALL, element.margin)
  if (element.margin_x !== undefined) node.setMargin(yoga.EDGE_HORIZONTAL, element.margin_x)
  if (element.margin_y !== undefined) node.setMargin(yoga.EDGE_VERTICAL, element.margin_y)
  if (element.margin_top !== undefined) node.setMargin(yoga.EDGE_TOP, element.margin_top)
  if (element.margin_right !== undefined) node.setMargin(yoga.EDGE_RIGHT, element.margin_right)
  if (element.margin_bottom !== undefined) node.setMargin(yoga.EDGE_BOTTOM, element.margin_bottom)
  if (element.margin_left !== undefined) node.setMargin(yoga.EDGE_LEFT, element.margin_left)

  // Border (tell yoga about border width so it affects layout).
  const hasBorder = element.border_style && element.border_style !== 'none'
  if (hasBorder) {
    const edges = element.border_edges || { top: true, right: true, bottom: true, left: true }
    if (edges.top !== false) node.setBorder(yoga.EDGE_TOP, 1)
    if (edges.right !== false) node.setBorder(yoga.EDGE_RIGHT, 1)
    if (edges.bottom !== false) node.setBorder(yoga.EDGE_BOTTOM, 1)
    if (edges.left !== false) node.setBorder(yoga.EDGE_LEFT, 1)
  }

  // Absolute positioning insets.
  if (element.inset !== undefined) node.setPosition(yoga.EDGE_ALL, element.inset)
  if (element.top !== undefined) node.setPosition(yoga.EDGE_TOP, element.top)
  if (element.right !== undefined) node.setPosition(yoga.EDGE_RIGHT, element.right)
  if (element.bottom !== undefined) node.setPosition(yoga.EDGE_BOTTOM, element.bottom)
  if (element.left !== undefined) node.setPosition(yoga.EDGE_LEFT, element.left)

  // Overflow.
  if (element.overflow === 'hidden' || element.overflow_x === 'hidden' || element.overflow_y === 'hidden') {
    node.setOverflow(yoga.OVERFLOW_HIDDEN)
  }

  // Build children (flatten fragments).
  const children = []
  const childElements = element.children || []
  for (let i = 0, len = childElements.length; i < len; i += 1) {
    const childTree = buildYogaTree(childElements[i], yoga, bg)
    if (!childTree) continue
    if (childTree.isFragment) {
      // Flatten fragment children into this node.
      for (let j = 0, flen = childTree.children.length; j < flen; j += 1) {
        const fc = childTree.children[j]
        node.insertChild(fc.node, children.length)
        children.push(fc)
      }
    } else {
      node.insertChild(childTree.node, children.length)
      children.push(childTree)
    }
  }

  return { bg, children, element, node }
}

// ---------------------------------------------------------------------------
// Buffer drawing
// ---------------------------------------------------------------------------

function drawTree(tree, native, bufPtr, offsetX, offsetY, parentFg, parentBg) {
  if (!tree || !tree.node) return

  const { element, node, children, bg } = tree
  const x = Math.round(offsetX + node.getComputedLeft())
  const y = Math.round(offsetY + node.getComputedTop())
  const w = Math.round(node.getComputedWidth())
  const h = Math.round(node.getComputedHeight())

  const elemBg = parseColor(element.background_color) || parentBg
  const elemFg = parseColor(element.color) || parentFg

  if (element.type === 'View') {
    // Fill background.
    if (element.background_color) {
      const bgColor = parseColor(element.background_color) || TRANSPARENT
      for (let row = 0; row < h; row += 1) {
        for (let col = 0; col < w; col += 1) {
          native.bufferSetCell(bufPtr, x + col, y + row, 32, // space
            bgColor[0], bgColor[1], bgColor[2], bgColor[3],
            bgColor[0], bgColor[1], bgColor[2], bgColor[3], 0)
        }
      }
    }

    // Draw border.
    const hasBorder = element.border_style && element.border_style !== 'none'
    if (hasBorder) {
      drawBorder(native, bufPtr, x, y, w, h, element, elemBg)
    }

    // Compute inner offset (padding + border).
    const borderTop = hasBorder && (element.border_edges?.top !== false) ? 1 : 0
    const borderLeft = hasBorder && (element.border_edges?.left !== false) ? 1 : 0

    const padTop = node.getComputedPadding(0) // EDGE_TOP = 0 in yoga
    const padLeft = node.getComputedPadding(3) // EDGE_LEFT = 3

    // Draw children.
    for (let i = 0, len = children.length; i < len; i += 1) {
      drawTree(children[i], native, bufPtr, x, y, elemFg || WHITE, elemBg || TRANSPARENT)
    }
  } else if (element.type === 'Text') {
    const fg = elemFg || WHITE
    const bg2 = elemBg || TRANSPARENT
    const attrs = buildAttributes(element)
    const content = element.content || ''
    const lines = content.split('\n')

    for (let lineIdx = 0, llen = lines.length; lineIdx < llen; lineIdx += 1) {
      const line = lines[lineIdx]
      if (line.length > 0) {
        native.bufferDrawText(bufPtr, line, x, y + lineIdx,
          fg[0], fg[1], fg[2], fg[3],
          bg2[0], bg2[1], bg2[2], bg2[3], attrs)
      }
    }
  } else if (element.type === 'MixedText') {
    // Draw all sections as a single contiguous span by concatenating
    // text and drawing it as one bufferDrawText call, then overwriting
    // per-character colors/attributes with bufferSetCell for sections
    // that differ from the first section's style.
    const contents = element.mixed_text_contents || []
    if (contents.length === 0) return
    const defaultBg = elemBg || TRANSPARENT

    // First pass: draw the full concatenated text with the first section's style.
    let fullText = ''
    for (let i = 0, len = contents.length; i < len; i += 1) {
      fullText += contents[i].text || ''
    }
    if (fullText.length === 0) return

    const firstFg = parseColor(contents[0].color) || elemFg || WHITE
    const firstAttrs = buildSectionAttributes(contents[0])
    native.bufferDrawText(bufPtr, fullText, x, y,
      firstFg[0], firstFg[1], firstFg[2], firstFg[3],
      defaultBg[0], defaultBg[1], defaultBg[2], defaultBg[3], firstAttrs)

    // Second pass: overwrite cells for sections with different styles.
    let curX = x + (contents[0].text || '').length
    for (let i = 1, len = contents.length; i < len; i += 1) {
      const section = contents[i]
      const text = section.text || ''
      if (text.length === 0) continue
      const fg = parseColor(section.color) || elemFg || WHITE
      const attrs = buildSectionAttributes(section)
      // Only overwrite if style differs from first section.
      for (let j = 0, tlen = text.length; j < tlen; j += 1) {
        native.bufferSetCell(bufPtr, curX + j, y, text.codePointAt(j),
          fg[0], fg[1], fg[2], fg[3],
          defaultBg[0], defaultBg[1], defaultBg[2], defaultBg[3], attrs)
      }
      curX += text.length
    }
  }
}

function drawBorder(native, bufPtr, x, y, w, h, element, bg) {
  const style = element.border_style
  let chars
  if (element.custom_border_chars) {
    const c = element.custom_border_chars
    chars = c.top_left + c.top + c.top_right + c.right + c.bottom_right + c.bottom + c.bottom_left + c.left
  } else {
    chars = BORDER_CHARS[style] || BORDER_CHARS.single
  }

  const edges = element.border_edges || { bottom: true, left: true, right: true, top: true }
  const borderColor = parseColor(element.border_color) || WHITE
  const bgColor = bg || TRANSPARENT

  // Draw corners and edges manually using setCell.
  // chars order: tl, t, tr, r, bl, b, br, l
  const tl = chars.codePointAt(0)
  const t = chars.codePointAt(1)
  const tr = chars.codePointAt(2)
  const r = chars.codePointAt(3)
  const bl = chars.codePointAt(4)
  const b = chars.codePointAt(5)
  const br = chars.codePointAt(6)
  const l = chars.codePointAt(7)

  const fc = borderColor
  const bc = bgColor

  // Top edge.
  if (edges.top !== false) {
    if (edges.left !== false) {
      native.bufferSetCell(bufPtr, x, y, tl, fc[0], fc[1], fc[2], fc[3], bc[0], bc[1], bc[2], bc[3], 0)
    }
    for (let col = 1; col < w - 1; col += 1) {
      native.bufferSetCell(bufPtr, x + col, y, t, fc[0], fc[1], fc[2], fc[3], bc[0], bc[1], bc[2], bc[3], 0)
    }
    if (edges.right !== false && w > 1) {
      native.bufferSetCell(bufPtr, x + w - 1, y, tr, fc[0], fc[1], fc[2], fc[3], bc[0], bc[1], bc[2], bc[3], 0)
    }
  }

  // Bottom edge.
  if (edges.bottom !== false && h > 1) {
    if (edges.left !== false) {
      native.bufferSetCell(bufPtr, x, y + h - 1, bl, fc[0], fc[1], fc[2], fc[3], bc[0], bc[1], bc[2], bc[3], 0)
    }
    for (let col = 1; col < w - 1; col += 1) {
      native.bufferSetCell(bufPtr, x + col, y + h - 1, b, fc[0], fc[1], fc[2], fc[3], bc[0], bc[1], bc[2], bc[3], 0)
    }
    if (edges.right !== false && w > 1) {
      native.bufferSetCell(bufPtr, x + w - 1, y + h - 1, br, fc[0], fc[1], fc[2], fc[3], bc[0], bc[1], bc[2], bc[3], 0)
    }
  }

  // Left edge.
  if (edges.left !== false) {
    for (let row = 1; row < h - 1; row += 1) {
      native.bufferSetCell(bufPtr, x, y + row, l, fc[0], fc[1], fc[2], fc[3], bc[0], bc[1], bc[2], bc[3], 0)
    }
  }

  // Right edge.
  if (edges.right !== false && w > 1) {
    for (let row = 1; row < h - 1; row += 1) {
      native.bufferSetCell(bufPtr, x + w - 1, y + row, r, fc[0], fc[1], fc[2], fc[3], bc[0], bc[1], bc[2], bc[3], 0)
    }
  }
}

// ---------------------------------------------------------------------------
// Buffer-to-ANSI serializer
// ---------------------------------------------------------------------------

/**
 * Read the buffer's raw cell data and produce a plain-text string.
 * This matches iocraft's renderToString behavior which returns
 * unformatted text without ANSI escape codes.
 */
function serializeBufferPlain(native, bufPtr, width, height) {
  const chars = new Uint32Array(native.bufferGetCharArrayBuffer(bufPtr))
  const lines = []

  for (let row = 0; row < height; row += 1) {
    let line = ''
    // Track last non-space column for trimming trailing spaces.
    let lastNonSpace = -1
    for (let col = 0; col < width; col += 1) {
      const idx = row * width + col
      if (chars[idx] !== 32) lastNonSpace = col
    }

    for (let col = 0; col <= lastNonSpace; col += 1) {
      const idx = row * width + col
      line += String.fromCodePoint(chars[idx])
    }

    lines.push(line)
  }

  // Trim trailing empty lines.
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  return lines.join('\n') + '\n'
}

/**
 * Read the buffer's raw cell data and produce an ANSI-colored string.
 * Used by printComponent/eprintComponent for terminal output with colors.
 */
function serializeBufferAnsi(native, bufPtr, width, height) {
  const chars = new Uint32Array(native.bufferGetCharArrayBuffer(bufPtr))
  const fgData = new Float32Array(native.bufferGetFgArrayBuffer(bufPtr))
  const bgData = new Float32Array(native.bufferGetBgArrayBuffer(bufPtr))
  const attrData = new Uint32Array(native.bufferGetAttributesArrayBuffer(bufPtr))

  const lines = []
  let prevFg = ''
  let prevBg = ''
  let prevAttr = 0

  for (let row = 0; row < height; row += 1) {
    let line = ''
    let lastNonSpace = -1
    for (let col = 0; col < width; col += 1) {
      const idx = row * width + col
      if (chars[idx] !== 32) lastNonSpace = col
    }

    for (let col = 0; col <= lastNonSpace; col += 1) {
      const idx = row * width + col
      const ch = chars[idx]
      const fgIdx = idx * 4
      const fgR = Math.round(fgData[fgIdx] * 255)
      const fgG = Math.round(fgData[fgIdx + 1] * 255)
      const fgB = Math.round(fgData[fgIdx + 2] * 255)
      const bgR = Math.round(bgData[fgIdx] * 255)
      const bgG = Math.round(bgData[fgIdx + 1] * 255)
      const bgB = Math.round(bgData[fgIdx + 2] * 255)
      const attr = attrData[idx] & 0xFF

      const fgKey = `${fgR};${fgG};${fgB}`
      const bgKey = `${bgR};${bgG};${bgB}`

      const parts = []
      if (attr !== prevAttr) {
        const removed = prevAttr & ~attr
        if (removed) {
          parts.push('\x1b[0m')
          prevFg = ''
          prevBg = ''
        }
        if (attr & TEXT_ATTR_BOLD && !(prevAttr & TEXT_ATTR_BOLD)) parts.push('\x1b[1m')
        if (attr & TEXT_ATTR_DIM && !(prevAttr & TEXT_ATTR_DIM)) parts.push('\x1b[2m')
        if (attr & TEXT_ATTR_ITALIC && !(prevAttr & TEXT_ATTR_ITALIC)) parts.push('\x1b[3m')
        if (attr & TEXT_ATTR_UNDERLINE && !(prevAttr & TEXT_ATTR_UNDERLINE)) parts.push('\x1b[4m')
        if (attr & TEXT_ATTR_STRIKETHROUGH && !(prevAttr & TEXT_ATTR_STRIKETHROUGH)) parts.push('\x1b[9m')
        prevAttr = attr
      }
      if (fgKey !== prevFg) {
        parts.push(`\x1b[38;2;${fgR};${fgG};${fgB}m`)
        prevFg = fgKey
      }
      if (bgKey !== prevBg && !(bgR === 0 && bgG === 0 && bgB === 0)) {
        parts.push(`\x1b[48;2;${bgR};${bgG};${bgB}m`)
        prevBg = bgKey
      }

      line += parts.join('') + String.fromCodePoint(ch)
    }

    lines.push(line)
    prevFg = ''
    prevBg = ''
    prevAttr = 0
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  return lines.join('\n') + '\x1b[0m\n'
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createRenderEngine(native) {
  // Load yoga-layout synchronously (embedded WASM).
  const yoga = require('./yoga-sync.cjs')

  function renderToStringWithWidth(element, maxWidth) {
    if (!element) return ''

    const termWidth = maxWidth || process.stdout.columns || 80

    // Wrap root fragments in an implicit View so yoga has a root node.
    let rootElement = element
    if (element.type === 'Fragment') {
      rootElement = { type: 'View', children: element.children || [] }
    }

    // Build yoga tree from element tree.
    const tree = buildYogaTree(rootElement, yoga, TRANSPARENT)
    if (!tree || !tree.node) return ''

    // Compute layout.
    tree.node.calculateLayout(termWidth, undefined, yoga.DIRECTION_LTR)

    const totalWidth = Math.round(tree.node.getComputedWidth())
    const totalHeight = Math.round(tree.node.getComputedHeight())

    if (totalWidth <= 0 || totalHeight <= 0) {
      tree.node.freeRecursive()
      return ''
    }

    // Create opentui buffer for drawing.
    const bufPtr = native.createOptimizedBuffer(totalWidth, totalHeight, false, 0, 'render')

    // Clear buffer.
    native.bufferClear(bufPtr, 0, 0, 0, 1)

    // Draw the element tree into the buffer.
    drawTree(tree, native, bufPtr, 0, 0, WHITE, TRANSPARENT)

    // Serialize buffer cells.
    const plainOutput = serializeBufferPlain(native, bufPtr, totalWidth, totalHeight)
    const ansiOutput = serializeBufferAnsi(native, bufPtr, totalWidth, totalHeight)

    // Cleanup.
    native.destroyOptimizedBuffer(bufPtr)
    tree.node.freeRecursive()

    return { ansi: ansiOutput, plain: plainOutput }
  }

  function renderToString(element) {
    const result = renderToStringWithWidth(element, undefined)
    return typeof result === 'string' ? result : result.plain
  }

  function printComponent(element) {
    const result = renderToStringWithWidth(element, undefined)
    if (!result) return
    const output = typeof result === 'string' ? result : result.ansi
    if (output) process.stdout.write(output)
  }

  function eprintComponent(element) {
    const result = renderToStringWithWidth(element, undefined)
    if (!result) return
    const output = typeof result === 'string' ? result : result.ansi
    if (output) process.stderr.write(output)
  }

  function getTerminalSize() {
    return [process.stdout.columns || 80, process.stdout.rows || 24]
  }

  return {
    eprintComponent,
    getTerminalSize,
    printComponent,
    renderToString,
    renderToStringWithWidth,
  }
}
