# Horizontal Bordered Input Fields

I've created the exact input field style you showed me - with **blue horizontal borders above and below** the input area!

## What You Get

### 1. Horizontal Bordered Input (What you asked for!)
The input field with blue borders above and below:

```bash
socket theme --hinput "Enter your command:"
```

Creates:
```
────────────────────────────────────────────────
Enter your command:
Type here...
────────────────────────────────────────────────
```

This matches exactly what you showed in your screenshot - the input field with horizontal blue lines above and below!

### 2. Minimal Input
Just a bottom border (even cleaner):

```bash
socket theme --minimal "What would you like to do?"
```

Creates:
```
What would you like to do? _
────────────────────────────────────────────────
```

### 3. Full Box Input (Original style)
Complete border all around:

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

## Try It Now!

```bash
# The horizontal bordered style you wanted:
socket theme --hinput "Enter command"

# Minimal style with just bottom border:
socket theme --minimal "Your input"

# Full bordered box:
socket theme --input "Type here"
```

## Features

- **Blue borders** that follow your theme color
- **Clean horizontal lines** using Unicode characters (─)
- **Placeholder text** that disappears when you type
- **Responsive width** that adjusts to your terminal
- **Theme-aware colors** that adapt to your selected theme

## In Interactive Mode

```bash
SOCKET_INTERACTIVE=1 socket theme --interactive
```

Then press:
- `i` - Full bordered input box
- `h` - Horizontal bordered input (what you wanted!)
- `m` - Menu demo

## Code Example

If you want to use this in your own code:

```typescript
import { horizontalBorderedInput } from './utils/horizontal-input.mts'

const answer = await horizontalBorderedInput('Enter your command:', {
  width: 60,
  borderColor: colors.blue,
  promptColor: colors.cyan,
  placeholder: 'Type here...'
})
```

This creates exactly the clean, modern input field with horizontal blue borders that you showed me in your screenshot!