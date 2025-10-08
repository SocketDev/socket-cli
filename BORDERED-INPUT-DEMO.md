# Bordered Input & UI Elements for Socket CLI

I've added **bordered input fields** and UI elements to the Socket CLI theme system - the "little blue border above and below that allow you to type in" that you asked about!

## Features Added

### 1. Bordered Text Box
Display text in a beautiful bordered frame:
```bash
socket theme --box "Hello World"
```
Output:
```
╭────────────────────────────────────────────────╮
│Hello World                                      │
╰────────────────────────────────────────────────╯
```

### 2. Bordered Input Prompt
Interactive input field with borders (like the one you described):
```bash
socket theme --input "Enter package name"
```
Creates:
```
╭────────────────────────────────────────────────╮
│ Enter package name                             │
│────────────────────────────────────────────────│
│ Type your answer here...                       │
╰────────────────────────────────────────────────╯
```

### 3. Bordered Menu
Interactive menu with borders:
```bash
socket theme --menu
```
Shows:
```
╭───── Socket CLI Options ─────╮
│──────────────────────────────│
│  1. Scan for vulnerabilities │
│  2. Fix issues               │
│  3. Check package            │
│  4. View report              │
╰──────────────────────────────╯
Select an option (1-4):
```

## Border Styles Available

The system supports multiple border styles:

### Single (Default)
```
┌─────────────┐
│ Content     │
└─────────────┘
```

### Double
```
╔═════════════╗
║ Content     ║
╚═════════════╝
```

### Rounded
```
╭─────────────╮
│ Content     │
╰─────────────╯
```

### Thick
```
┏━━━━━━━━━━━━━┓
┃ Content     ┃
┗━━━━━━━━━━━━━┛
```

## Interactive Demo

Try the interactive explorer to see all border styles:
```bash
SOCKET_INTERACTIVE=1 socket theme --interactive
```

Then press:
- `b` - Show bordered box
- `i` - Show input prompt
- `m` - Show menu demo

## How It Works

The bordered input system uses Unicode box-drawing characters to create visual frames around content:

1. **Box Drawing Characters**: Uses Unicode characters like `┌`, `─`, `┐`, `│`, `└`, `┘`
2. **Dynamic Width**: Automatically adjusts to content or specified width
3. **Color Support**: Borders follow the active theme colors
4. **Input Capture**: For input fields, captures typed text within the bordered area
5. **Cursor Management**: Properly positions cursor inside the box for typing

## Use Cases

- **Input Forms**: Create visually appealing input prompts
- **Menus**: Display options in organized bordered lists
- **Information Display**: Frame important messages or alerts
- **Status Windows**: Show real-time updates in bordered areas
- **Configuration**: Display settings in structured boxes

## Code Example

You can use these in your own Socket CLI extensions:

```typescript
import { borderedInput, borderedMenu, createBox } from './utils/bordered-input.mts'

// Create a simple box
const box = createBox('Hello World', 50, 'rounded', colors.blue)
console.log(box)

// Get user input with bordered prompt
const answer = await borderedInput('Enter your name:', {
  width: 50,
  style: 'rounded',
  color: colors.cyan,
  placeholder: 'Type here...'
})

// Show a menu
const choice = await borderedMenu(
  'Select Option',
  ['Option 1', 'Option 2', 'Option 3'],
  'double',
  colors.magenta
)
```

## Terminal Compatibility

These bordered UI elements work best in terminals that support:
- Unicode characters
- ANSI escape codes
- Cursor positioning

Most modern terminals (Terminal.app, iTerm2, VS Code terminal, Windows Terminal, etc.) fully support these features.

## Try It Now!

```bash
# Show text in a box
socket theme --box "Socket CLI
Secure your supply chain"

# Interactive input
socket theme --input "What package would you like to scan?"

# Menu demo
socket theme --menu
```

The bordered input system brings a polished, professional look to CLI interactions, making the Socket CLI more user-friendly and visually appealing!