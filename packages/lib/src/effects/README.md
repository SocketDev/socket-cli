# Visual Effects

**Terminal text effects and animations** — Shimmer, pulse, rainbow, and more.

---

## 📦 What's Included

```
effects/
├── shimmer.ts      # Shimmer animation effect
├── pulse.ts        # Pulse (fade in/out) effect
├── ultra.ts        # Rainbow gradient effect
└── none.ts         # No effect (passthrough)
```

---

## 🎨 Effects Overview

### Shimmer
**Smooth horizontal wave animation**

```typescript
import { shimmer } from '@socketsecurity/lib/effects/shimmer'

const animated = shimmer('Processing...')
// Output: Shimmering text effect
```

**Use cases:** Loading states, progress indicators

---

### Pulse
**Fade in/out breathing effect**

```typescript
import { pulse } from '@socketsecurity/lib/effects/pulse'

const animated = pulse('Waiting for input')
// Output: Pulsing text effect
```

**Use cases:** Waiting states, attention grabbers

---

### Ultra
**Rainbow gradient (pride colors)**

```typescript
import { ultra } from '@socketsecurity/lib/effects/ultra'

const animated = ultra('🌈 Success!')
// Output: Rainbow gradient text
```

**Use cases:** Success messages, celebrations, branding

---

### None
**Passthrough (no effect)**

```typescript
import { none } from '@socketsecurity/lib/effects/none'

const text = none('Plain text')
// Output: Unchanged text
```

**Use cases:** Disabling effects, testing, accessibility

---

## 🎭 Using with Themes

Effects are integrated with the theme system:

```typescript
import { setTheme } from '@socketsecurity/lib/themes'
import { Spinner } from '@socketsecurity/lib/spinner'

// Set theme (applies effect to spinners automatically)
setTheme('ultra')  // Rainbow effect

const spinner = Spinner({ text: 'Processing...' })
spinner.start()
// Spinner text has rainbow effect!
```

**Available themes:**
- `none` — No effects
- `default` — Standard colors, no animation
- `pulse` — Pulse effect
- `shimmer` — Shimmer effect
- `ultra` — Rainbow effect

See [../themes/README.md](../themes/README.md) for theme details.

---

## ⚙️ How Effects Work

Effects are **pure functions** that transform strings:

```typescript
type EffectFunction = (text: string) => string

// Simple implementation example:
function myEffect(text: string): string {
  return chalk.cyan(text) // Apply color/styling
}
```

**Key properties:**
- Pure functions (no side effects)
- String in, styled string out
- Composable
- Frame-based for animations

---

## 🔧 Advanced: Frame-based Animation

Animated effects use frame numbers for smooth animation:

```typescript
// Shimmer uses frames for wave animation
function shimmer(text: string, frame = 0): string {
  // frame determines wave position
  const offset = frame % text.length
  // Apply gradient based on offset...
  return styledText
}

// In spinner (simplified):
let frame = 0
setInterval(() => {
  process.stdout.write(shimmer('Loading', frame++))
}, 100)
```

---

## 🎨 Colors & ANSI

Effects use [yoctocolors](https://github.com/sindresorhus/yoctocolors) for colors:

```typescript
import colors from 'yoctocolors-cjs'

colors.red('Error')
colors.green('Success')
colors.blue('Info')
colors.yellow('Warning')
colors.cyan('Step')
```

**Why yoctocolors-cjs?**
- CommonJS compatible
- Tiny (2KB)
- Full color support
- Works everywhere

---

## ♿ Accessibility

Effects automatically disable in:
- CI environments (`CI=true`)
- Non-TTY environments
- When `NO_COLOR=1`
- Accessibility modes

```typescript
import { getCI } from '@socketsecurity/lib/env/ci'
import { isInteractive } from '@socketsecurity/lib/stdio'

if (getCI() || !isInteractive()) {
  // Use 'none' effect automatically
}
```

---

## 📊 Performance

Effects are optimized for minimal overhead:

| Effect | Overhead | Notes |
|--------|----------|-------|
| none | ~0ms | Passthrough |
| ultra | ~0.1ms | Static gradient |
| pulse | ~0.2ms | Frame calculation |
| shimmer | ~0.3ms | Wave calculation |

**All effects:** < 0.5ms per call (negligible)

---

## 🧪 Testing Effects

Test effects with snapshots:

```typescript
import { describe, it, expect } from 'vitest'
import { shimmer } from '../shimmer'

describe('shimmer', () => {
  it('applies shimmer effect', () => {
    const result = shimmer('test', 0)
    expect(result).toMatchSnapshot()
  })

  it('animates with frames', () => {
    const frame0 = shimmer('test', 0)
    const frame1 = shimmer('test', 1)
    expect(frame0).not.toBe(frame1) // Frames differ
  })
})
```

---

## 🔗 Related Modules

- [../themes/](../themes/) — Theme system that uses effects
- [../spinner.ts](../spinner.ts) — Spinner with effect support
- [../logger.ts](../logger.ts) — Logger with colored output
- [../stdio/](../stdio/) — Terminal I/O utilities

---

## 📚 Examples

### Example 1: Spinner with Ultra Effect

```typescript
import { Spinner, setTheme } from '@socketsecurity/lib'

setTheme('ultra')

const spinner = Spinner({ text: 'Analyzing packages...' })
spinner.start()

// Do work...
await analyzePackages()

spinner.stop()
```

### Example 2: Custom Effect Application

```typescript
import { shimmer } from '@socketsecurity/lib/effects/shimmer'

let frame = 0
setInterval(() => {
  console.clear()
  console.log(shimmer('🌊 Wave animation!', frame++))
}, 100)
```

### Example 3: Conditional Effects

```typescript
import { getCI } from '@socketsecurity/lib/env/ci'
import { ultra } from '@socketsecurity/lib/effects/ultra'
import { none } from '@socketsecurity/lib/effects/none'

const effect = getCI() ? none : ultra

console.log(effect('Success!'))
// CI: plain text
// Local: rainbow text
```

---

## 💡 Tips

- **Use `ultra` for celebrations** — Success messages, completions
- **Use `pulse` for waiting** — Long-running operations
- **Use `shimmer` for progress** — Active processing
- **Use `none` in CI** — Automatic via environment detection
- **Test without effects** — Disable for snapshot tests

---

## 🆘 Troubleshooting

### Effects not showing?

Check environment:
```typescript
import { getCI } from '@socketsecurity/lib/env/ci'
import { isInteractive } from '@socketsecurity/lib/stdio'

console.log({
  ci: getCI(),              // Should be false
  interactive: isInteractive(), // Should be true
  noColor: process.env.NO_COLOR // Should be undefined
})
```

### Colors look wrong?

Check terminal color support:
```bash
echo $TERM          # Should be xterm-256color or similar
echo $COLORTERM     # May be truecolor
```

---

**See [docs/themes.md](../../docs/themes.md) for complete theme system documentation.**
