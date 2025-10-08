# Socket CLI Theme System

The Socket CLI now includes a full theme system with animated transitions and context-aware color changes!

## How to Access the Theme System

### 1. Interactive Tour
```bash
# Start the tour to see basic themes in action
SOCKET_INTERACTIVE=1 socket tour
```

### 2. Theme Command
The new `socket theme` command provides full access to the theme system:

```bash
# Show current theme
socket theme

# List all available themes
socket theme --list

# Set a theme (purple, green, brick, coana)
socket theme --set green

# Show animated demo with theme transitions
socket theme --demo

# Show color wave animation
socket theme --wave

# Show pulse animation
socket theme --pulse "Your text here"

# Interactive theme explorer (requires TTY or SOCKET_INTERACTIVE=1)
SOCKET_INTERACTIVE=1 socket theme --interactive
```

## Features

### Theme Components
- **Colors**: Primary, secondary, accent, success, warning, error, info
- **Elements**: Headings, commands, code blocks, links
- **Icons**: Checkmarks, arrows, bullets, warnings
- **Severity Levels**: Critical, high, medium, low
- **Interactive**: Prompts, inputs, selections
- **Tables**: Headers, rows, borders

### Context-Aware Themes
The theme system automatically switches themes based on context:
- **Python context**: Green theme with 🐍 snake icon
- **Firewall context**: Brick/orange-red theme with 🔥 fire icon
- **Coana context**: Purple theme for code analysis

### Animations
- **Theme Transitions**: Smooth animated transitions between themes
- **Color Wave**: Rainbow wave effect across text
- **Pulse**: Attention-grabbing pulse effect
- **Context Switching**: Glitch-style transitions when switching contexts

## Configuration

Themes are defined in `themes.json` at the project root. You can add custom themes by editing this file:

```json
{
  "themes": {
    "yourtheme": {
      "name": "yourtheme",
      "description": "Your custom theme",
      "colors": {
        "primary": "magenta",
        "secondary": "blue",
        // ... more colors
      }
    }
  }
}
```

## Interactive Explorer

The interactive explorer (`socket theme --interactive`) provides a real-time playground:
- Press 1-5 to switch themes
- Press p/f/c to push Python/Firewall/Coana contexts
- Press o to pop context
- Press w for wave animation
- Press s for pulse animation
- Press d for full demo
- Press q to quit

## Use in Code

The theme system is available throughout the CLI codebase:

```typescript
import { getTheme, setTheme } from './utils/theme.mts'
import { pushContext, popContext } from './utils/theme-transitions.mts'

// Get current theme
const theme = getTheme()
console.log(theme.primary('Primary text'))
console.log(theme.success('Success!'))

// Switch contexts with animations
await pushContext('python', true)
// ... Python-themed operations ...
await popContext(true)
```

## Demo

To see everything in action:
```bash
# Full animated demo
socket theme --demo

# Interactive exploration
SOCKET_INTERACTIVE=1 socket theme --interactive
```

The theme system enhances the Socket CLI experience with:
- Visual feedback for different operation contexts
- Animated transitions that make context switches clear
- Consistent color coding across all commands
- Customizable themes for different preferences

Try it out with `socket theme --demo` to see the full capabilities!