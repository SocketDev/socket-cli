# Socket CLI Text Effects & Animations

I've added several text animation effects to the Socket CLI theme system. The animations are now slower and more visible per your feedback.

## Animation Speed Improvements

- **Frame Duration**: Increased from 50ms to 100ms for theme transitions
- **Total Duration**: Increased from 500ms to 1500ms for theme transitions
- **Color Wave**: Slowed down to 150ms per frame, 4 seconds total
- **Pulse Effect**: Doubled duration to 400ms per pulse
- **Loading Dots**: 400ms between each dot state

## Available Text Effects

### 1. Typewriter Effect
Creates a typing animation effect, character by character:
```bash
socket theme --type "Analyzing your dependencies..."
```

### 2. Loading Dots
Shows loading animation with cycling dots:
```bash
socket theme --loading "Scanning"
# Output: Scanning → Scanning. → Scanning.. → Scanning... → repeat
```

### 3. Glitch Text
Creates a cyberpunk-style glitch effect:
```bash
socket theme --glitch "⚠️  Security Alert ⚠️"
```

### 4. Color Wave
Rainbow wave effect across text:
```bash
socket theme --wave
```

### 5. Pulse Animation
Text that pulses between bright and dim:
```bash
socket theme --pulse "⚡ Socket Security ⚡"
```

### 6. Theme Transitions
Smooth animated transitions between different color themes:
```bash
socket theme --demo
```

## Interactive Mode

Try all effects in real-time:
```bash
SOCKET_INTERACTIVE=1 socket theme --interactive
```

Commands in interactive mode:
- `t` - Typewriter effect
- `l` - Loading dots
- `g` - Glitch text
- `w` - Color wave
- `s` - Pulse animation
- `d` - Full demo with transitions
- `1-5` - Switch themes
- `p/f/c` - Push Python/Firewall/Coana contexts
- `o` - Pop context
- `q` - Quit

## How the Effects Work

### Typewriter Effect
The typewriter effect builds up text character by character, simulating typing:
```typescript
for (const char of text) {
  output += char
  stdout.write(`\r${color(output)}`)
  await delay(100)  // 100ms between characters
}
```

### Loading Dots
Cycles through 0-3 dots after the text:
```typescript
for (let dots = 0; dots <= 3; dots++) {
  stdout.write(`\r${text}${'.'.repeat(dots)}`)
  await delay(400)  // 400ms between states
}
```

### Glitch Effect
Randomly replaces characters with glitch symbols:
- Starts clean, builds up glitch to 30% of characters
- Then reduces glitch back to clean text
- Uses special characters: `!@#$%^&*()_+-=[]{}|;:,.<>?/~\``

### Theme Transitions
Complex multi-phase animation:
1. **Fade out** (0-20%): Dims current theme
2. **Glitch phase** (20-40%): Random characters change color
3. **Color mixing** (40-60%): Strikethrough effect
4. **Glitch to new** (60-80%): New theme colors appear
5. **Fade in** (80-100%): Solid new theme

## Customization

All timings can be adjusted in `src/utils/theme-transitions.mts`:
- `FRAME_DURATION`: Base frame rate (currently 100ms)
- `waveFrameDuration`: Color wave speed (150ms)
- Individual effect durations can be passed as parameters

## Use Cases

- **Loading states**: Use loading dots for operations in progress
- **Important messages**: Pulse effect for alerts
- **Context switches**: Theme transitions show mode changes
- **Fun factor**: Color wave for special occasions
- **Errors/warnings**: Glitch effect for security alerts
- **Progressive reveal**: Typewriter for step-by-step output

The text effects make the CLI more engaging and provide visual feedback that helps users understand what's happening during operations.