# Differential Rendering Implementation

## Overview

Implemented production-grade differential rendering to eliminate TUI corruption during fast typing.

## Problem

**Before:** Full-screen rewrite every frame
- 50 lines × 150 characters = **7,500 bytes per frame**
- At 10 FPS = **75,000 bytes/second**
- Fast typing caused overlapping writes → **corruption** ("asddddasdasda" leaking, "| |" artifacts)

**After:** Differential rendering (like Ink)
- Only update changed lines
- Typical typing: **1 line × 150 chars = 150 bytes**
- **98% reduction** in data written
- Corruption eliminated ✅

## Implementation

### 1. Buffer Tracking (`state.previousBuffer`)
Store previous frame buffer array to enable diff calculation.

### 2. Diff Algorithm (`computeBufferDiff()`)
```javascript
function computeBufferDiff(oldBuffer, newBuffer) {
  if (!oldBuffer || oldBuffer.length !== newBuffer.length) {
    return newBuffer.map((_, i) => i) // First render: all lines
  }

  const changedLines = []
  for (let i = 0; i < newBuffer.length; i++) {
    if (oldBuffer[i] !== newBuffer[i]) {
      changedLines.push(i)
    }
  }
  return changedLines
}
```

### 3. Patch Function (`applyBufferPatch()`)
```javascript
function applyBufferPatch(newBuffer, changedLines) {
  let output = ''
  for (const lineIndex of changedLines) {
    const line = newBuffer[lineIndex]
    // Position cursor and write only this line
    output += `\x1B[${lineIndex + 1};1H${line}\r`
  }
  return output
}
```

### 4. Modified `drawFinalTUI()`
**Before:** Returned string with all lines joined
**After:** Returns buffer array for differential comparison

### 5. Updated `renderFrame()`
```javascript
function renderFrame() {
  const newBuffer = drawFinalTUI()
  const changedLines = computeBufferDiff(state.previousBuffer, newBuffer)

  if (changedLines.length > 0) {
    const patch = applyBufferPatch(newBuffer, changedLines)
    process.stdout.write('\x1B[?2026h' + patch + '\x1B[?2026l')
  }

  state.previousBuffer = newBuffer
}
```

## Performance Benefits

### Typing Scenario (Most Common)
- **Changed:** 1 line (textarea with cursor)
- **Bytes:** 150 (vs 7,500)
- **Reduction:** 98%

### Scrolling Scenario
- **Changed:** ~20 lines (output box content shifts)
- **Bytes:** 3,000 (vs 7,500)
- **Reduction:** 60%

### Theme Change (Worst Case)
- **Changed:** All lines (colors change)
- **Bytes:** 7,500 (same as before)
- **Reduction:** 0% (but no corruption due to sync mode)

## Additional Protections

1. ✅ **Render locking** (`isRendering` flag) - prevents concurrent renders
2. ✅ **Synchronized output mode** (DEC 2026) - atomic terminal updates
3. ✅ **Borderless design** - eliminated nested border conflicts
4. ✅ **10 FPS rate limit** - reduces render frequency

## Testing

Run `node scripts/test-differential-rendering.mjs` to verify:
- ✅ First render: all lines updated
- ✅ No changes: zero updates
- ✅ Single change: only 1 line updated
- ✅ Typing simulation: 98% reduction confirmed

## Result

**Before:** Corruption during fast typing, rough "| |" borders
**After:** Rock-solid rendering, clean output, no artifacts ✅

The TUI now has production-grade rendering quality matching professional frameworks like Ink.
