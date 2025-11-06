# Theme System

Socket Lib provides a comprehensive theming system for consistent branding across spinners, text effects, links, prompts, and logger output.

## Quick Reference

| Theme | Use Case | Primary Color | Special Effects |
|-------|----------|---------------|-----------------|
| **`lush`** | Steel elegance | Steel blue `#4682B4` + Gold `#FFD700` | Elegant harmony |
| **`socket`** (default) | Socket Security | Violet `#8C52FF` | Subtle shimmer |
| **`sunset`** | Vibrant twilight | Orange `#FF8C64` + Pink `#C864B4` | Purple-to-orange gradient |
| **`terracotta`** | Solid warmth | Terracotta `#FF6432` | Rich shimmer |
| **`ultra`** | Premium intensity | 🌈 Prismatic | Rainbow shimmer |

### Quick Start

```typescript
import { setTheme, Spinner } from '@socketsecurity/lib'

setTheme('terracotta')  // Set once at startup
const spinner = Spinner({ text: 'Scanning...' })
spinner.start()         // Uses terracotta theme automatically
```

---

## Core Concepts

### 🎨 What's a Theme?

A theme defines the visual identity for all CLI components:

```
Theme
├── Colors          → Brand & semantic colors
│   ├── Brand       → primary, secondary
│   ├── Semantic    → success, error, warning, info
│   └── UI          → text, links, prompts
│
└── Effects         → Visual enhancements
    ├── Spinner     → Style & animation
    ├── Shimmer     → Gradient text effects
    └── Pulse       → Breathing animations
```

### 🔄 Theme Lifecycle

```
┌─────────────┐
│ App Startup │
└──────┬──────┘
       │
       ↓
┌─────────────────┐         ┌──────────────┐
│ setTheme('xxx') │────────→│ Global Theme │
└─────────────────┘         └──────┬───────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ↓              ↓              ↓
              ┌─────────┐    ┌─────────┐    ┌────────┐
              │ Spinner │    │ Logger  │    │ Links  │
              └─────────┘    └─────────┘    └────────┘
```

### 📚 Theme Stack

Themes use a stack model for temporary changes:

```typescript
// Stack visualization:
// ┌──────────┐
// │  ultra   │ ← popTheme() removes this
// ├──────────┤
// │  sunset  │ ← pushTheme() adds here
// ├──────────┤
// │  socket  │ ← Base theme
// └──────────┘

pushTheme('sunset')       // Add to stack
pushTheme('ultra')        // Add another
popTheme()                // Remove ultra → back to sunset
popTheme()                // Remove sunset → back to socket
```

### 🎯 Scoped Themes (Recommended)

Use `withTheme()` for automatic cleanup:

```typescript
import { withTheme } from '@socketsecurity/lib/themes'

// Before: sunset theme
await withTheme('ultra', async () => {
  // Inside: ultra theme 🌈
  const spinner = Spinner({ text: 'MAXIMUM POWER!' })
  await epicOperation()
})
// After: sunset theme (auto-restored)
```

**Visual Flow:**
```
Normal Flow    → [sunset] → [sunset] → [sunset]
                    ↓
withTheme()    → [sunset] → [ultra] → [sunset]
                           ↑─────────↑
                           Auto-restore
```

---

## Built-in Themes

### 🔷 Lush

```typescript
setTheme('lush')
```

| Attribute | Value |
|-----------|-------|
| **Primary Color** | `#4682B4` (Steel blue) |
| **Secondary Color** | `#FFD700` (Gold) |
| **Best For** | Elegant interfaces, harmonious design |
| **Spinner** | Dots style, clean animations |
| **Visual Style** | Elegant theme with steel blue and golden harmony |

### 🟣 Socket Security (Default)

```typescript
setTheme('socket')
```

| Attribute | Value |
|-----------|-------|
| **Primary Color** | `#8C52FF` (Refined violet) |
| **Best For** | Socket.dev tools, security scanning |
| **Spinner** | Socket style with subtle shimmer |
| **Visual Style** | Signature theme designed for focus and elegance |

**Preview:**
```
✓ Package scan complete        # Green
✗ Vulnerability detected        # Red
⚠ 3 issues require attention    # Yellow
→ Installing dependencies...    # Cyan
```

### 🌅 Sunset

```typescript
setTheme('sunset')
```

| Attribute | Value |
|-----------|-------|
| **Primary Color** | `#FF8C64` (Warm orange) |
| **Secondary Color** | `#C864B4` (Purple/pink) |
| **Best For** | Coana branding, warm interfaces, twilight aesthetics |
| **Spinner** | Dots style, clean animations |
| **Effects** | Purple-to-orange gradient shimmer |
| **Visual Style** | Vibrant twilight gradient with warm sunset tones |

### 🟠 Terracotta

```typescript
setTheme('terracotta')
```

| Attribute | Value |
|-----------|-------|
| **Primary Color** | `#FF6432` (Terracotta) |
| **Secondary Color** | `#FF9664` (Light terracotta) |
| **Best For** | Grounded confidence, warm interfaces |
| **Spinner** | Socket style with rich shimmer |
| **Visual Style** | Solid theme with rich terracotta and ember warmth |

### 🌈 Ultra

```typescript
setTheme('ultra')
```

| Attribute | Value |
|-----------|-------|
| **Primary Color** | `#8C52FF` with rainbow shimmer |
| **Best For** | Deep analysis, premium experiences |
| **Effects** | Prismatic shimmer, bidirectional rainbow |
| **Spinner** | Socket style with rainbow effects |
| **Visual Style** | Premium intensity where complexity meets elegance |

**When to use Ultra:**
- Complex analysis operations
- Premium feature demonstrations
- Deep diagnostic sessions
- Maximum visual impact needed

---

## API Reference

### Core Functions

#### `setTheme(theme)`
Set global theme (use at app startup)

```typescript
import { setTheme } from '@socketsecurity/lib/themes'

// By name
setTheme('terracotta')

// By custom object
setTheme(myCustomTheme)
```

#### `getTheme()`
Get current active theme

```typescript
import { getTheme } from '@socketsecurity/lib/themes'

const theme = getTheme()
console.log(theme.displayName)  // "Socket Security"
console.log(theme.colors.primary)  // [140, 82, 255]
```

### Stack Management

#### `pushTheme(theme)` / `popTheme()`
Manual stack operations

```typescript
import { pushTheme, popTheme } from '@socketsecurity/lib/themes'

pushTheme('ultra')    // Switch to ultra
// ... operations ...
popTheme()            // Restore previous
```

⚠️ **Warning:** Always match `push` with `pop` to avoid theme leaks!

#### `withTheme(theme, fn)` ✨ Recommended
Auto-managed theme scope (async)

```typescript
import { withTheme } from '@socketsecurity/lib/themes'

await withTheme('sunset', async () => {
  await doAnalysis()
})
// Theme auto-restored
```

#### `withThemeSync(theme, fn)`
Auto-managed theme scope (sync)

```typescript
import { withThemeSync } from '@socketsecurity/lib/themes'

const result = withThemeSync('terracotta', () => {
  return processSecurity()
})
```

### Theme Creation

#### `createTheme(config)`
Build custom theme from scratch

```typescript
import { createTheme } from '@socketsecurity/lib/themes'

const myTheme = createTheme({
  name: 'my-theme',
  displayName: 'My Theme',
  colors: {
    primary: [255, 100, 200],
    success: 'greenBright',
    error: 'redBright',
    warning: 'yellowBright',
    info: 'blueBright',
    step: 'cyanBright',
    text: 'white',
    textDim: 'gray',
    link: 'cyanBright',
    prompt: 'primary'
  }
})
```

#### `extendTheme(base, overrides)`
Customize existing theme

```typescript
import { extendTheme, SOCKET_THEME } from '@socketsecurity/lib/themes'

const customTheme = extendTheme(SOCKET_THEME, {
  name: 'custom-socket',
  colors: {
    primary: [200, 100, 255]  // Different purple
  }
})
```

### Event Handling

#### `onThemeChange(listener)`
React to theme changes

```typescript
import { onThemeChange } from '@socketsecurity/lib/themes'

const unsubscribe = onThemeChange((theme) => {
  console.log('Theme changed to:', theme.displayName)
  updateMyUI(theme)
})

// Stop listening
unsubscribe()
```

---

## Integration

### Spinners 🔄

Spinners inherit theme colors and styles automatically:

```typescript
import { Spinner, setTheme } from '@socketsecurity/lib'

setTheme('ultra')
const spinner = Spinner({ text: 'Processing...' })
spinner.start()  // 🌈 Rainbow spinner!
```

**Override for specific spinner:**
```typescript
const spinner = Spinner({
  text: 'Custom color',
  color: [255, 100, 50]  // Ignores theme
})
```

### Logger 📝

Logger symbols use theme colors:

```typescript
import { logger, setTheme } from '@socketsecurity/lib'

setTheme('terracotta')

logger.success('Build complete')     // ✓ in green
logger.error('Build failed')         // ✗ in red
logger.warn('Update available')      // ⚠ in yellow
logger.info('System status: OK')     // ℹ in blue
```

**Output Preview:**
```
✓ Build complete           # Theme success color
✗ Build failed             # Theme error color
⚠ Update available         # Theme warning color
ℹ System status: OK        # Theme info color
```

### Links 🔗

Create themed terminal hyperlinks:

```typescript
import { link } from '@socketsecurity/lib/links'

// Uses current theme
console.log(link('Documentation', 'https://socket.dev'))

// Override theme
console.log(link('API', 'https://api.socket.dev', {
  theme: 'sunset'
}))

// Show URL fallback
console.log(link('GitHub', 'https://github.com', {
  fallback: true
}))
// Output: "GitHub (https://github.com)"
```

---

## Color System

### Color Types

| Type | Example | Description |
|------|---------|-------------|
| **Named colors** | `'red'`, `'greenBright'` | Standard terminal colors |
| **RGB tuples** | `[255, 100, 50]` | Custom RGB (0-255 each) |
| **Theme refs** | `'primary'`, `'secondary'` | Reference theme colors |
| **Special** | `'rainbow'`, `'inherit'` | Dynamic colors |

### Color Reference Table

```typescript
colors: {
  // Brand colors
  primary: [140, 82, 255],     // Main brand color
  secondary: [100, 200, 255],  // Optional accent

  // Semantic colors (status indicators)
  success: 'greenBright',      // ✓ Success messages
  error: 'redBright',          // ✗ Error messages
  warning: 'yellowBright',     // ⚠ Warning messages
  info: 'blueBright',          // ℹ Info messages
  step: 'cyanBright',          // → Progress steps

  // UI colors
  text: 'white',               // Regular text
  textDim: 'gray',             // Secondary/dim text
  link: 'cyanBright',          // Hyperlinks
  prompt: 'primary'            // Interactive prompts
}
```

### Named Colors Reference

| Basic | Bright | Use Case |
|-------|--------|----------|
| `'red'` | `'redBright'` | Errors, critical issues |
| `'green'` | `'greenBright'` | Success, completion |
| `'yellow'` | `'yellowBright'` | Warnings, caution |
| `'blue'` | `'blueBright'` | Info, general status |
| `'cyan'` | `'cyanBright'` | Links, progress |
| `'magenta'` | `'magentaBright'` | Highlights, special |
| `'white'` | `'whiteBright'` | Text, content |
| `'gray'` | `'blackBright'` | Dim text, disabled |

💡 **Tip:** Use `Bright` variants for better terminal visibility!

---

## Common Patterns

### Pattern 1: Product Branding

```typescript
import { setTheme, Spinner } from '@socketsecurity/lib'

// Set theme once at startup
setTheme('terracotta')

// All components inherit theme
const spinner = Spinner({ text: 'Building project...' })
spinner.start()
```

### Pattern 2: Temporary Theme Switch

```typescript
import { withTheme, logger } from '@socketsecurity/lib'

// Normal operations
logger.info('Starting scan...')

// Switch to ultra for celebration
await withTheme('ultra', async () => {
  logger.success('🎉 All packages safe!')
})

// Back to normal
logger.info('Scan complete')
```

### Pattern 3: Custom Product Theme

```typescript
import { createTheme, setTheme } from '@socketsecurity/lib/themes'

const myProductTheme = createTheme({
  name: 'my-product',
  displayName: 'My Product',
  colors: {
    primary: [50, 150, 250],
    secondary: [255, 200, 0],
    success: 'greenBright',
    error: 'redBright',
    warning: 'yellowBright',
    info: 'cyanBright',
    step: 'blueBright',
    text: 'white',
    textDim: 'gray',
    link: 'secondary',
    prompt: 'primary'
  },
  meta: {
    description: 'Custom theme for My Product CLI',
    version: '1.0.0'
  }
})

setTheme(myProductTheme)
```

---

## Best Practices

### ✅ Do's

1. **Set theme early** — Call `setTheme()` at application startup
2. **Use scoped themes** — Prefer `withTheme()` over manual push/pop
3. **Use color references** — Use `'primary'` instead of hard-coded RGB
4. **Test all themes** — Verify output looks good with each theme
5. **Document custom themes** — Add `meta` with description

### ❌ Don'ts

1. **Don't forget to pop** — Always match `pushTheme()` with `popTheme()`
2. **Don't hard-code colors** — Use theme system for consistency
3. **Don't nest excessively** — Keep theme nesting shallow (< 3 levels)
4. **Don't ignore terminal support** — Test in different terminals
5. **Don't overuse ultra** — Save rainbow mode for special moments! 🌈

---


## Troubleshooting

### Q: Theme changes not taking effect?

**A:** Rebuild the project after theme changes:
```bash
pnpm run build
```

### Q: How do I know which theme is active?

**A:** Use `getTheme()`:
```typescript
const theme = getTheme()
console.log(theme.name, theme.displayName)
// "socket" "Socket Security"
```

### Q: Can I use custom RGB colors?

**A:** Yes! Specify as `[R, G, B]` tuples (0-255):
```typescript
colors: {
  primary: [255, 100, 200]  // Custom pink
}
```

### Q: Why use references like 'primary'?

**A:** References adapt when themes change:
```typescript
colors: {
  link: 'primary'  // Follows theme primary color
}

// Changes automatically when theme changes!
setTheme('sunset')       // Links become warm orange
setTheme('terracotta')   // Links become warm peachy coral (secondary)
```

### Q: Theme not restoring after crash?

**A:** Use `withTheme()` for automatic cleanup:
```typescript
// ✅ Safe - auto-restores even on error
await withTheme('ultra', async () => {
  await riskyOperation()
})

// ❌ Risky - theme stuck if error
pushTheme('ultra')
await riskyOperation()  // If this throws, theme stuck!
popTheme()
```

---

## Theme Type Reference

Complete TypeScript definition:

```typescript
type Theme = {
  name: string
  displayName: string

  colors: {
    // Brand
    primary: ColorValue
    secondary?: ColorValue

    // Semantic
    success: ColorValue
    error: ColorValue
    warning: ColorValue
    info: ColorValue
    step: ColorValue

    // UI
    text: ColorValue
    textDim: ColorValue
    link: ColorReference
    prompt: ColorReference
  }

  effects?: {
    spinner?: {
      color?: ColorReference
      style?: SpinnerStyle | string
    }
    shimmer?: {
      enabled?: boolean
      color?: ColorReference | ColorValue[]
      direction?: 'ltr' | 'rtl' | 'ttb' | 'btt'
      speed?: number
    }
    pulse?: {
      speed?: number
    }
  }

  meta?: {
    description?: string
    author?: string
    version?: string
  }
}

type ColorValue = string | [number, number, number]
type ColorReference = ColorValue | 'primary' | 'secondary' | 'inherit' | 'rainbow'
```

---

## Next Steps

| Resource | Description |
|----------|-------------|
| [**Getting Started**](./getting-started.md) | Development workflow, commands |
| [**Build Architecture**](./build.md) | How the build system works |
| [**CLAUDE.md**](../CLAUDE.md) | Coding standards & patterns |

