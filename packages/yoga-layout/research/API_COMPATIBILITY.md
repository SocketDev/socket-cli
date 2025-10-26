# API Compatibility Matrix

This document provides a detailed compatibility matrix between Yoga Layout's official API and this Taffy-based implementation.

## Status Legend

- ✅ **Fully Supported**: Works exactly as Yoga, tested and verified
- ⚠️ **Partial Support**: Implemented but with known limitations or differences
- 🚧 **Planned**: Not yet implemented but technically feasible
- ❌ **Not Supported**: Fundamental limitation, cannot be supported with current Taffy version

## Node API

### Tree Management

| Method | Status | Notes |
|--------|--------|-------|
| `Node.create(config?)` | ✅ | Factory method works, config optional |
| `insertChild(child, index)` | ⚠️ | Taffy appends children; index tracked but may not affect layout order ([src/lib.rs:36-40](src/lib.rs#L36-L40)) |
| `removeChild(child)` | ✅ | Fully supported |
| `getChild(index)` | ✅ | Returns child at index from adapter layer |
| `getChildCount()` | ✅ | Returns correct count |
| `getParent()` | ✅ | Tracked in adapter layer |

**Reference**: [Yoga Node API](https://yogalayout.dev/docs/api/node)

### Lifecycle

| Method | Status | Notes |
|--------|--------|-------|
| `free()` | ✅ | No-op (WASM GC handles memory) ([src/lib.rs:406-409](src/lib.rs#L406-L409)) |
| `freeRecursive()` | ✅ | No-op (WASM GC handles memory) ([src/lib.rs:411-415](src/lib.rs#L411-L415)) |
| `reset()` | ✅ | Resets to default style ([src/lib.rs:417-421](src/lib.rs#L417-L421)) |
| `copyStyle(node)` | ⚠️ | Stub implementation, marks dirty but doesn't copy styles |

### Layout Calculation

| Method | Status | Notes |
|--------|--------|-------|
| `calculateLayout(width, height, direction)` | ✅ | Fully supported, undefined becomes MaxContent |
| `markDirty()` | ✅ | Tracked in adapter layer |
| `isDirty()` | ✅ | Tracked in adapter layer |
| `hasNewLayout()` | ✅ | Tracked in adapter layer |
| `markLayoutSeen()` | ✅ | Clears hasNewLayout flag |

### Layout Getters

| Method | Status | Notes |
|--------|--------|-------|
| `getComputedLeft()` | ✅ | Maps to Taffy layout.location.x ([src/lib.rs:336-342](src/lib.rs#L336-L342)) |
| `getComputedTop()` | ✅ | Maps to Taffy layout.location.y ([src/lib.rs:344-350](src/lib.rs#L344-L350)) |
| `getComputedWidth()` | ✅ | Maps to Taffy layout.size.width ([src/lib.rs:353-360](src/lib.rs#L353-L360)) |
| `getComputedHeight()` | ✅ | Maps to Taffy layout.size.height ([src/lib.rs:362-369](src/lib.rs#L362-L369)) |
| `getComputedRight()` | ✅ | Calculated as left + width ([src/lib.rs:371-378](src/lib.rs#L371-L378)) |
| `getComputedBottom()` | ✅ | Calculated as top + height ([src/lib.rs:380-387](src/lib.rs#L380-L387)) |
| `getComputedLayout()` | ✅ | Returns all computed values as object |
| `getComputedMargin(edge)` | 🚧 | Not yet implemented |
| `getComputedPadding(edge)` | 🚧 | Not yet implemented |
| `getComputedBorder(edge)` | ❌ | Taffy v0.6 doesn't include border in layout |

### Flexbox Properties

| Method | Status | Notes |
|--------|--------|-------|
| `setFlexDirection(direction)` | ✅ | Enum mapping: Column=0, ColumnReverse=1, Row=2, RowReverse=3 ([src/lib.rs:107-119](src/lib.rs#L107-L119)) |
| `setJustifyContent(justify)` | ✅ | Maps to Taffy JustifyContent ([src/lib.rs:121-136](src/lib.rs#L121-L136)) |
| `setAlignItems(align)` | ✅ | Maps to Taffy AlignItems, SpaceBetween/SpaceAround fallback to Start ([src/lib.rs:138-155](src/lib.rs#L138-L155)) |
| `setAlignContent(align)` | ✅ | Maps to Taffy AlignContent, Baseline fallback to Start ([src/lib.rs:157-174](src/lib.rs#L157-L174)) |
| `setAlignSelf(align)` | ✅ | Maps to Taffy AlignSelf ([src/lib.rs:176-193](src/lib.rs#L176-L193)) |
| `setFlexWrap(wrap)` | ✅ | Maps to Taffy FlexWrap: NoWrap=0, Wrap=1, WrapReverse=2 ([src/lib.rs:195-207](src/lib.rs#L195-L207)) |
| `setFlex(flex)` | ✅ | Sets flexGrow=flex, flexShrink=1, flexBasis=0 ([src/lib.rs:209-217](src/lib.rs#L209-L217)) |
| `setFlexGrow(flexGrow)` | ✅ | Direct mapping to Taffy ([src/lib.rs:219-225](src/lib.rs#L219-L225)) |
| `setFlexShrink(flexShrink)` | ✅ | Direct mapping to Taffy ([src/lib.rs:227-233](src/lib.rs#L227-L233)) |
| `setFlexBasis(flexBasis)` | ✅ | Converts to Dimension::Length ([src/lib.rs:235-241](src/lib.rs#L235-L241)) |

**Reference**: [CSS Flexbox Spec](https://www.w3.org/TR/css-flexbox-1/)

### Sizing Properties

| Method | Status | Notes |
|--------|--------|-------|
| `setWidth(width)` | ✅ | Converts to Dimension::Length ([src/lib.rs:58-64](src/lib.rs#L58-L64)) |
| `setHeight(height)` | ✅ | Converts to Dimension::Length ([src/lib.rs:66-72](src/lib.rs#L66-L72)) |
| `setMinWidth(minWidth)` | ✅ | Converts to Dimension::Length ([src/lib.rs:74-80](src/lib.rs#L74-L80)) |
| `setMinHeight(minHeight)` | ✅ | Converts to Dimension::Length ([src/lib.rs:82-88](src/lib.rs#L82-L88)) |
| `setMaxWidth(maxWidth)` | ✅ | Converts to Dimension::Length ([src/lib.rs:90-96](src/lib.rs#L90-L96)) |
| `setMaxHeight(maxHeight)` | ✅ | Converts to Dimension::Length ([src/lib.rs:98-104](src/lib.rs#L98-L104)) |
| `setWidthPercent(width)` | 🚧 | Not yet implemented |
| `setHeightPercent(height)` | 🚧 | Not yet implemented |
| `setWidthAuto()` | 🚧 | Not yet implemented |
| `setHeightAuto()` | 🚧 | Not yet implemented |

### Spacing Properties

| Method | Status | Notes |
|--------|--------|-------|
| `setPadding(edge, padding)` | ✅ | Uses LengthPercentage, supports all edges including Horizontal/Vertical/All shortcuts ([src/lib.rs:243-278](src/lib.rs#L243-L278)) |
| `setPaddingPercent(edge, padding)` | 🚧 | Not yet implemented |
| `setMargin(edge, margin)` | ✅ | Uses LengthPercentageAuto, supports all edges including Horizontal/Vertical/All shortcuts ([src/lib.rs:280-315](src/lib.rs#L280-L315)) |
| `setMarginPercent(edge, margin)` | 🚧 | Not yet implemented |
| `setMarginAuto(edge)` | 🚧 | Not yet implemented |
| `setBorder(edge, border)` | ❌ | Taffy v0.6 doesn't support border in layout calculations |

**Edge Enum Mapping** ([src/enums.mjs:38-48](src/enums.mjs#L38-L48)):
- Left = 0
- Top = 1
- Right = 2
- Bottom = 3
- Start = 4 (mapped to Left)
- End = 5 (mapped to Right)
- Horizontal = 6 (sets Left + Right)
- Vertical = 7 (sets Top + Bottom)
- All = 8 (sets all four edges)

### Other Properties

| Method | Status | Notes |
|--------|--------|-------|
| `setDisplay(display)` | 🚧 | Not yet implemented (Flex=0, None=1) |
| `setPosition(position)` | ❌ | Absolute positioning not supported in Taffy |
| `setPositionType(positionType)` | ❌ | Absolute positioning not supported |
| `setAspectRatio(aspectRatio)` | 🚧 | Not yet implemented |
| `setOverflow(overflow)` | 🚧 | Not yet implemented |
| `setDirection(direction)` | 🚧 | Not yet implemented |
| `setGap(gutter, gap)` | 🚧 | Not yet implemented |

### Measure Function

| Method | Status | Notes |
|--------|--------|-------|
| `setMeasureFunc(measureFunc)` | ⚠️ | Stored but not integrated with layout calculations (Taffy limitation) |
| `unsetMeasureFunc()` | ⚠️ | Clears stored function |
| `setDirtiedFunc(dirtiedFunc)` | ✅ | Called when node is marked dirty |

**Limitation**: Yoga allows custom measure functions for leaf nodes (e.g., measuring text). Taffy doesn't provide this extension point. Measure functions are stored for API compatibility but don't affect layout calculations.

**Workaround**: Pre-calculate sizes and set them explicitly using `setWidth()`/`setHeight()`.

**Reference**: [Yoga Measure Function](https://yogalayout.dev/docs/api/node#measure-function)

## Config API

### Configuration Options

| Method | Status | Notes |
|--------|--------|-------|
| `Config.create()` | ✅ | Factory method works |
| `free()` | ✅ | No-op (WASM GC) |
| `setUseWebDefaults(enabled)` | ⚠️ | Stored but doesn't affect Taffy |
| `useWebDefaults()` | ⚠️ | Returns stored value |
| `setPointScaleFactor(factor)` | ⚠️ | Stored but doesn't affect Taffy |
| `setExperimentalFeatureEnabled(feature, enabled)` | ⚠️ | No-op (Taffy has no experimental features) |
| `isExperimentalFeatureEnabled(feature)` | ⚠️ | Always returns false |
| `setErrata(errata)` | ⚠️ | No-op (Taffy has no errata flags) |
| `getErrata()` | ⚠️ | Always returns 0 |

**Limitation**: Taffy doesn't have equivalent configuration options. These are provided for API compatibility but don't affect layout calculations.

**Reference**: [Yoga Config API](https://yogalayout.dev/docs/api/config)

## Enum Values

All enum values match Yoga's numeric values for API compatibility.

### Align

```javascript
Align.Auto = 0
Align.FlexStart = 1
Align.Center = 2
Align.FlexEnd = 3
Align.Stretch = 4
Align.Baseline = 5
Align.SpaceBetween = 6   // ⚠️ Falls back to Start in alignItems/alignSelf
Align.SpaceAround = 7    // ⚠️ Falls back to Start in alignItems/alignSelf
Align.SpaceEvenly = 8
```

**Reference**: [src/enums.mjs:10-20](src/enums.mjs#L10-L20)

### FlexDirection

```javascript
FlexDirection.Column = 0
FlexDirection.ColumnReverse = 1
FlexDirection.Row = 2
FlexDirection.RowReverse = 3
```

**Reference**: [src/enums.mjs:50-56](src/enums.mjs#L50-L56)

### Justify

```javascript
Justify.FlexStart = 0
Justify.Center = 1
Justify.FlexEnd = 2
Justify.SpaceBetween = 3
Justify.SpaceAround = 4
Justify.SpaceEvenly = 5
```

**Reference**: [src/enums.mjs:58-66](src/enums.mjs#L58-L66)

### Wrap

```javascript
Wrap.NoWrap = 0
Wrap.Wrap = 1
Wrap.WrapReverse = 2
```

**Reference**: [src/enums.mjs:68-73](src/enums.mjs#L68-L73)

## Known Differences from Yoga

### 1. insertChild Index Behavior

**Yoga**: Children can be inserted at specific indices, affecting layout order.

**This Implementation**: Taffy's `add_child()` appends children to the end. The index parameter is tracked in the JavaScript adapter layer ([src/index.mjs:190-200](src/index.mjs#L190-L200)), but the underlying Taffy layout may not respect insertion order in all cases.

**Impact**: Mostly cosmetic. Most applications insert children sequentially (0, 1, 2...) where this works correctly.

**Workaround**: Remove and re-add children if order needs to change.

### 2. Measure Functions

**Yoga**: Supports custom measure functions for leaf nodes (used for text measurement, images, etc.).

**This Implementation**: Measure functions are stored but not called during layout ([src/index.mjs:349-361](src/index.mjs#L349-L361)).

**Impact**: Applications using measure functions (like Ink for text measurement) must pre-calculate sizes.

**Workaround**: Calculate dimensions externally and set them with `setWidth()`/`setHeight()`.

**Potential Solution**: Would require forking Taffy to add measure function support, or implementing a pre-layout measurement pass.

### 3. Config Options

**Yoga**: Config options affect layout calculations (web defaults, point scaling, errata).

**This Implementation**: Config options are stored for API compatibility but don't affect Taffy's calculations.

**Impact**: Minimal. Most applications don't use these options. Web defaults differences are subtle.

### 4. Border Layout

**Yoga**: Border is included in layout calculations.

**This Implementation**: Taffy v0.6 doesn't include border in the layout model.

**Impact**: Applications using border for spacing must use padding instead.

**Workaround**: Convert border to padding: `setPadding(edge, borderWidth + paddingWidth)`.

### 5. Absolute Positioning

**Yoga**: Supports absolute positioning with `setPosition()` and `setPositionType(PositionType.Absolute)`.

**This Implementation**: Absolute positioning not implemented.

**Impact**: Applications using absolute positioning will not work correctly.

**Status**: Could be implemented by mapping to Taffy's position support (future work).

## Testing Against Yoga Suite

We test compatibility using Yoga's official test suite as a submodule (v3.1.0):

```
.yoga-tests/javascript/tests/
├── generated/              # ~900 generated tests
│   ├── YGFlexTest.test.ts
│   ├── YGPaddingTest.test.ts
│   ├── YGMarginTest.test.ts
│   └── ...
└── YG*.test.ts             # ~50 manual tests
```

**Test Approach**: Tests are adapted to use our implementation's API. Tests that rely on unsupported features (border, absolute positioning, measure functions) are marked as expected failures.

**Reference**: [TESTING.md](./TESTING.md)

## Migration Guide

### From Yoga C++ to This Implementation

Most applications should work with minimal changes:

#### 1. Import Change

```javascript
// Before (Yoga C++)
import Yoga from 'yoga-layout'

// After (Taffy-based)
import Yoga from '@socketsecurity/yoga-layout'
await Yoga.init()  // Initialize WASM
```

#### 2. Measure Functions

If your application uses measure functions:

```javascript
// Before (Yoga C++)
node.setMeasureFunc((width, widthMode, height, heightMode) => {
  const measured = measureText(text, width)
  return { width: measured.width, height: measured.height }
})

// After (Taffy-based) - Pre-calculate and set explicitly
const measured = measureText(text, maxWidth)
node.setWidth(measured.width)
node.setHeight(measured.height)
```

#### 3. Border

If your application uses border:

```javascript
// Before (Yoga C++)
node.setBorder(Edge.All, 2)
node.setPadding(Edge.All, 10)

// After (Taffy-based) - Combine into padding
node.setPadding(Edge.All, 12)  // 2 (border) + 10 (padding)
```

### From Other Flexbox Implementations

The API closely matches Yoga, which is widely used. Key differences from CSS flexbox:

- Use method calls instead of CSS properties
- Use enum values instead of strings
- Must call `calculateLayout()` to trigger layout (not automatic)
- Read computed values with getters, not from style properties

## Future Compatibility

### Planned Improvements

- [ ] Display property (Display.None for hiding elements)
- [ ] Aspect ratio support
- [ ] Gap (grid-gap) support
- [ ] Percentage-based sizing methods
- [ ] Auto-sizing methods
- [ ] Computed margin/padding getters

### Requires Taffy Changes

- [ ] Measure function integration
- [ ] Border in layout model
- [ ] Absolute positioning with positioning properties

### Tracking Issues

Track compatibility issues and feature requests:
- Implementation: [src/lib.rs](src/lib.rs)
- Adapter layer: [src/index.mjs](src/index.mjs)
- Tests: `.yoga-tests/`

## References

- **Yoga Layout API**: https://yogalayout.dev/docs/api
- **Taffy Documentation**: https://github.com/DioxusLabs/taffy
- **W3C Flexbox Spec**: https://www.w3.org/TR/css-flexbox-1/
- **Our Implementation**: [src/lib.rs](src/lib.rs), [src/index.mjs](src/index.mjs)
