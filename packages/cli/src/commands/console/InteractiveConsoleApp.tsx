// @ts-nocheck
/**
 * @fileoverview Interactive console for Socket CLI with AI-powered natural language processing.
 *
 * Layout:
 * - Header: 6 lines (logo + metadata) - always visible
 * - Console: Dynamic height, min 2 lines - scrollable output area
 * - Input: Grows upward with Shift+Enter, max (termHeight - 9)
 * - Status: 1 line - always visible at bottom
 */

import { Box, Static, Text, useApp, useInput, useStdout } from 'ink'
import TextInput from 'ink-text-input'
import type React from 'react'
import {
  createElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { getAsciiHeader } from '../../utils/terminal/ascii-header-banner.mts'

const TOP_SPACER_HEIGHT = 0 // Lines of spacing at top
const HEADER_HEIGHT = 6 // Logo (4) + info lines (2: divider + CLI info)
const MIN_CONSOLE_HEIGHT = 5 // Minimum lines to show in console
const STATUS_HEIGHT = 1 // Status content (1)
const MIN_INPUT_HEIGHT = 1 // Minimum visible lines for input
const MAX_INPUT_HEIGHT_RATIO = 0.4 // Max 40% of terminal height
const _GAP_HEIGHT = 0 // No gaps - boxes touch each other

// Disable shimmer until Ink rendering issues resolved.
const _shouldDisableAnimations = true
const _SHIMMER_INTERVAL = 100 // ms between frames (smooth animation)

type FocusArea = 'console' | 'input'

export interface DiffLine {
  type: 'addition' | 'removal' | 'context'
  content: string
}

export interface ConsoleMessage {
  text: string
  timestamp: Date
  diff?: DiffLine[]
  dimmed?: boolean // Dim less important messages.
}

/**
 * Create diff lines for package changes (legacy format).
 */
export function createPackageChangeDiff(
  changes: {
    package: string
    before: string
    after: string
    reason?: string
  }[],
): DiffLine[] {
  const lines: DiffLine[] = []

  for (const change of changes) {
    // Package name (context).
    lines.push({
      content: change.package,
      type: 'context',
    })

    // Before version (removal).
    lines.push({
      content: `  ${change.before}`,
      type: 'removal',
    })

    // After version (addition).
    lines.push({
      content: `  ${change.after}`,
      type: 'addition',
    })

    // Reason (context).
    if (change.reason) {
      lines.push({
        content: `  → ${change.reason}`,
        type: 'context',
      })
    }

    // Spacing.
    lines.push({
      content: '',
      type: 'context',
    })
  }

  return lines
}

/**
 * Create file diff lines from before/after content.
 * Shows unified diff format with line numbers and context.
 */
export function createFileDiff(
  beforeContent: string,
  afterContent: string,
  _contextLines = 3,
): DiffLine[] {
  const beforeLines = beforeContent.split('\n')
  const afterLines = afterContent.split('\n')
  const diffLines: DiffLine[] = []

  // Simple line-by-line diff (for demo purposes).
  // In production, use a proper diff algorithm like Myers diff.
  const maxLines = Math.max(beforeLines.length, afterLines.length)

  for (let i = 0; i < maxLines; i++) {
    const beforeLine = beforeLines[i]
    const afterLine = afterLines[i]

    if (beforeLine === afterLine) {
      // Context line (unchanged).
      if (beforeLine !== undefined) {
        diffLines.push({
          content: beforeLine,
          type: 'context',
        })
      }
    } else {
      // Lines differ - show removal then addition.
      if (beforeLine !== undefined) {
        diffLines.push({
          content: beforeLine,
          type: 'removal',
        })
      }
      if (afterLine !== undefined) {
        diffLines.push({
          content: afterLine,
          type: 'addition',
        })
      }
    }
  }

  return diffLines
}

export interface InteractiveConsoleAppProps {
  buildHash?: string
  devMode?: boolean
  onCommand?: (
    command: string,
    addMessage: (textOrMessage: string | ConsoleMessage) => void,
  ) => Promise<void>
  version?: string
}

/**
 * Header component - renders once, never updates.
 */
const _StaticHeader = memo(
  function StaticHeader({
    buildHash,
    devMode,
    version,
  }: {
    version?: string
    buildHash?: string
    devMode?: boolean
  }): React.ReactElement {
    const headerContent = useMemo(
      () => getAsciiHeader('console', undefined, false, {}),
      [],
    )

    return createElement(
      Box,
      { flexDirection: 'column', flexShrink: 0, paddingX: 2 },
      createElement(Text, {}, headerContent),
    )
  },
  () => true, // Never re-render
)

/**
 * Console output area - simplified.
 */
const _ConsoleOutput = memo(function ConsoleOutput({
  messages,
}: {
  messages: ConsoleMessage[]
}): React.ReactElement {
  return createElement(
    Box,
    {
      flexDirection: 'column',
      flexGrow: 1,
      flexShrink: 0,
      paddingX: 1,
    },
    // Use Static to render messages - prevents re-rendering existing messages (no flicker).
    createElement(
      Static,
      { items: messages },
      (msg: ConsoleMessage, i: number) => {
        const elements = []

        // Main message text with subtle green tint for console feel.
        const isCommandOutput =
          !msg.text.startsWith('>') &&
          !msg.text.includes('→') &&
          !msg.text.includes('✓') &&
          !msg.text.includes('✗')
        elements.push(
          createElement(
            Text,
            {
              key: `msg-${i}`,
              color: isCommandOutput ? '#86EFAC' : undefined,
              dimColor: msg.dimmed || false,
            },
            msg.text,
          ),
        )

        // Render diff if present with line numbers and background highlighting.
        if (msg.diff) {
          // Calculate max line number width for alignment.
          const maxLineNum = msg.diff.length
          const lineNumWidth = String(maxLineNum).length

          for (const [diffIdx, line] of msg.diff.entries()) {
            const lineNum = (diffIdx + 1).toString().padStart(lineNumWidth, ' ')
            let bgColor: string | undefined
            let color: string
            let dimColor: boolean
            let prefix: string

            switch (line.type) {
              case 'addition':
                bgColor = '#1A3A1A' // Dark green background.
                color = '#E0E0E0' // Light gray text (readable on dark green).
                prefix = '+'
                dimColor = false
                break
              case 'removal':
                bgColor = '#3A1A2A' // Dark pink background.
                color = '#E0E0E0' // Light gray text (readable on dark pink).
                prefix = '-'
                dimColor = false
                break
              case 'context':
                bgColor = undefined // No background for context.
                color = '#6B7280' // Dim gray text.
                prefix = ' '
                dimColor = true
                break
            }

            elements.push(
              createElement(
                Text,
                {
                  key: `diff-${i}-${diffIdx}`,
                  backgroundColor: bgColor,
                  color,
                  dimColor,
                },
                ` ${lineNum} ${prefix} ${line.content}`,
              ),
            )
          }
        }

        // Return Box with all elements.
        return createElement(
          Box,
          { key: i, flexDirection: 'column' },
          ...elements,
        )
      },
    ),
  )
})

/**
 * Input area - simplified.
 */
const InputArea = memo(
  function InputArea({
    commandHistory,
    height,
    isFocused,
    onHeightChange,
    onSubmit,
  }: {
    commandHistory: string[]
    height: number
    isFocused: boolean
    onHeightChange: (lineCount: number) => void
    onSubmit: (command: string) => void
  }): React.ReactElement {
    // Internal state - isolated from parent.
    const [value, setValue] = useState('')
    const [historyIndex, setHistoryIndex] = useState(-1)

    // Notify parent of height changes once on mount (always 1 line).
    useEffect(() => {
      onHeightChange(1)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Handle up/down arrow navigation for command history.
    useInput((_input, key) => {
      // Only accept input when this area is focused.
      if (!isFocused) {
        return
      }

      // Up arrow: Navigate backward in history.
      if (key.upArrow) {
        if (commandHistory.length > 0) {
          const newIndex = historyIndex + 1
          if (newIndex < commandHistory.length) {
            setHistoryIndex(newIndex)
            const historicalCommand =
              commandHistory[commandHistory.length - 1 - newIndex]!
            setValue(historicalCommand)
          }
        }
        return
      }

      // Down arrow: Navigate forward in history.
      if (key.downArrow) {
        if (historyIndex > 0) {
          const newIndex = historyIndex - 1
          setHistoryIndex(newIndex)
          const historicalCommand =
            commandHistory[commandHistory.length - 1 - newIndex]!
          setValue(historicalCommand)
        } else if (historyIndex === 0) {
          setHistoryIndex(-1)
          setValue('')
        }
        return
      }
    })

    // Handle command submission.
    const handleSubmit = useCallback(
      (submittedValue: string) => {
        const command = submittedValue.trim()
        if (command) {
          onSubmit(command)
          setHistoryIndex(-1)
          setValue('')
        }
      },
      [onSubmit],
    )

    return createElement(
      Box,
      {
        borderBottom: true,
        borderColor: isFocused ? '#7B5FBF' : '#3F3F3F',
        borderLeft: true,
        borderRight: true,
        borderStyle: 'single',
        borderTop: true,
        flexDirection: 'row',
        flexShrink: 0,
        paddingX: 1,
      },
      createElement(Text, { color: isFocused ? '#B0B0B0' : '#5A5A5A' }, '> '),
      isFocused
        ? createElement(TextInput, {
            onChange: setValue,
            onSubmit: handleSubmit,
            value,
          })
        : createElement(
            Text,
            { color: isFocused ? '#B0B0B0' : '#5A5A5A' },
            value,
          ),
    )
  },
  (prevProps, nextProps) => prevProps.isFocused === nextProps.isFocused, // Re-render if focus state changes
)

/**
 * Readonly gray input area for displaying latest message.
 */
function _InputAreaGray({ message }: { message: string }): React.ReactElement {
  const [displayMessage, setDisplayMessage] = useState(message)

  useEffect(() => {
    setDisplayMessage(message)
  }, [message])

  return createElement(
    Box,
    {
      borderBottom: true,
      borderColor: '#6B7280',
      borderLeft: true,
      borderRight: true,
      borderStyle: 'single',
      borderTop: true,
      flexDirection: 'row',
      flexShrink: 0,
      paddingX: 1,
    },
    createElement(Text, {}, displayMessage),
  )
}

/**
 * Status bar - shows status and Ctrl+C exit prompt.
 */
const StatusBar = memo(
  function StatusBar({
    ctrlCPressed,
  }: {
    ctrlCPressed: boolean
  }): React.ReactElement {
    const statusText = ctrlCPressed ? 'Press Ctrl+C again to exit' : '◇ Ready'
    const statusColor = ctrlCPressed ? 'gray' : 'gray'

    return createElement(
      Box,
      {
        alignItems: 'flex-start',
        flexShrink: 0,
        height: 1,
        justifyContent: 'flex-start',
        paddingX: 1,
      },
      createElement(
        Text,
        { color: statusColor, dimColor: !ctrlCPressed },
        statusText,
      ),
    )
  },
  (prevProps, nextProps) => prevProps.ctrlCPressed === nextProps.ctrlCPressed, // Re-render if ctrlCPressed changes
)

/**
 * Main interactive console application.
 */
const InteractiveConsoleAppComponent = function InteractiveConsoleApp({
  buildHash,
  devMode,
  onCommand,
  version,
}: InteractiveConsoleAppProps): React.ReactElement {
  const { exit } = useApp()
  const { stdout } = useStdout()

  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [ctrlCPressed, setCtrlCPressed] = useState(false)
  const [ctrlCTimestamp, setCtrlCTimestamp] = useState(0)
  const [grayBoxScrollOffset, setGrayBoxScrollOffset] = useState(0)
  const [hasExecutedCommand, setHasExecutedCommand] = useState(false)
  const [inputLineCount, setInputLineCount] = useState(1)
  const [messages, setMessages] = useState<ConsoleMessage[]>([])
  const [focused, setFocused] = useState<'input' | 'gray'>('input')

  // Callback to add messages to console (memoized to prevent creating new function on every render).
  const addMessage = useCallback((textOrMessage: string | ConsoleMessage) => {
    if (typeof textOrMessage === 'string') {
      setMessages(prev => [
        ...prev,
        { text: textOrMessage, timestamp: new Date() },
      ])
    } else {
      setMessages(prev => [...prev, textOrMessage])
    }
    // Reset scroll offset to show latest messages.
    setGrayBoxScrollOffset(0)
  }, [])

  // Calculate dynamic heights - input grows with content, console shrinks.
  // Memoize to prevent recalculation on every render.
  const termHeight = useMemo(() => stdout.rows || 30, [stdout.rows])

  const heights = useMemo(() => {
    const maxInputHeight = Math.floor(termHeight * MAX_INPUT_HEIGHT_RATIO)

    // Input height = number of lines (no borders).
    const inputHeight = Math.max(
      MIN_INPUT_HEIGHT,
      Math.min(inputLineCount, maxInputHeight),
    )

    // Total fixed heights.
    const fixedHeights = TOP_SPACER_HEIGHT + HEADER_HEIGHT + STATUS_HEIGHT

    // Remaining space for console + input.
    const dynamicSpace = termHeight - fixedHeights

    // Console gets remainder after input.
    const consoleHeight = Math.max(
      MIN_CONSOLE_HEIGHT,
      dynamicSpace - inputHeight,
    )

    return { consoleHeight, inputHeight }
  }, [inputLineCount, termHeight])

  const { consoleHeight, inputHeight } = heights

  // TODO: Mouse click detection for focus switching.
  // Current challenge: When we enable ANSI mouse tracking escape codes,
  // the terminal sends mouse events as escape sequences on stdin (e.g., \x1b[<0;17;35M).
  // Both our stdin.on('data') handler AND Ink's useInput see the same data.
  // Ink doesn't recognize these as mouse events, so it treats them as text input,
  // causing escape sequences to appear in the input field.
  //
  // Potential solutions:
  // 1. Fork Ink to add native mouse support
  // 2. Use stdin.setRawMode(true) and handle ALL input ourselves (major refactor)
  // 3. Pre-filter stdin before Ink sees it (requires patching Node.js stream)
  // 4. Use a blessed/blessed-contrib approach with complete terminal control
  //
  // For now: Use Tab key to switch focus (works perfectly).
  // Future: Implement proper mouse support when we have time for the refactor.

  // Callbacks for InputArea (memoized to prevent re-renders).
  const handleInputHeightChange = useCallback((lineCount: number) => {
    setInputLineCount(prevCount => {
      // Only update if actually changed to prevent unnecessary re-renders.
      if (prevCount !== lineCount) {
        return lineCount
      }
      return prevCount
    })
  }, [])

  const handleInputSubmit = useCallback(
    (command: string) => {
      // Mark that we've executed a command (show gray box now).
      setHasExecutedCommand(true)

      // Handle clear command.
      if (command.toLowerCase().trim() === 'clear') {
        setMessages([])
        setCommandHistory(prev => [...prev, command])
        return
      }

      // Add to history (always append, never mutate).
      setCommandHistory(prev => [...prev, command])

      // Echo command.
      addMessage(`> ${command}`)

      // Execute.
      if (onCommand) {
        onCommand(command, addMessage)
      }
    },
    [onCommand, addMessage],
  )

  // Keyboard input handling.
  useInput((input, key) => {
    // Tab: Cycle focus between input and gray box.
    if (key.tab) {
      setFocused(prev => (prev === 'input' ? 'gray' : 'input'))
      // Reset scroll offset when switching to grey box.
      setGrayBoxScrollOffset(0)
      return
    }

    // Grey box scrolling with up/down arrows.
    if (focused === 'gray') {
      const nonEmptyMessages = messages.filter(msg => msg.text.length > 0)
      const maxOffset = Math.max(0, nonEmptyMessages.length - 1)

      if (key.upArrow) {
        setGrayBoxScrollOffset(prev => Math.min(prev + 1, maxOffset))
        return
      }

      if (key.downArrow) {
        setGrayBoxScrollOffset(prev => Math.max(prev - 1, 0))
        return
      }
    }

    // Ctrl+C: First press shows warning, second press exits.
    if (key.ctrl && input === 'c') {
      const now = Date.now()

      // Second press must be at least 100ms after first (prevent key repeat).
      if (ctrlCPressed && now - ctrlCTimestamp >= 100) {
        // Second press - exit.
        exit()
        return
      }

      // First press - set state for second press check.
      setCtrlCPressed(true)
      setCtrlCTimestamp(now)
      return
    }

    // Reset Ctrl+C state on any other key.
    if (ctrlCPressed) {
      setCtrlCPressed(false)
    }
  })

  // Auto-dismiss Ctrl+C warning after 2 seconds.
  useEffect(() => {
    if (!ctrlCPressed) {
      return
    }

    const timeout = setTimeout(() => {
      setCtrlCPressed(false)
    }, 2000)

    return () => {
      clearTimeout(timeout)
    }
  }, [ctrlCPressed])

  // Get ASCII header with all version and org info.
  const headerContent = useMemo(
    () => getAsciiHeader('console', undefined, false, {}),
    [],
  )

  // Combine header, welcome messages, and command messages into one Static items array.
  const headerLines = headerContent.split('\n')
  const welcomeLines = [
    ' ',
    'Welcome to Socket CLI interactive mode!',
    'Type commands or use natural language.',
    'Try: "scan", "ls", "whoami", or any socket command',
    ' ',
  ]
  const headerItems = [...headerLines, ...welcomeLines]

  // Messages without wrapping - just show as-is
  const wrappedMessages: Array<{ text: string; isCommandOutput: boolean }> = []
  for (const msg of messages) {
    const isCommandOutput =
      !msg.text.startsWith('>') &&
      !msg.text.includes('→') &&
      !msg.text.includes('✓') &&
      !msg.text.includes('✗')
    wrappedMessages.push({ isCommandOutput, text: msg.text })
  }

  const _allItems = [...headerItems, ...wrappedMessages]

  return createElement(
    Box,
    { flexDirection: 'column', minHeight: 0 },

    // Console area.
    createElement(
      Box,
      {
        flexDirection: 'column',
        flexGrow: 1,
        flexShrink: 1,
        minHeight: 0,
        paddingX: 2,
      },
      // Header section (logo + welcome).
      createElement(
        Static,
        { items: headerItems },
        (item: string, i: number) => {
          const isHeaderLine = i < headerLines.length
          const isWelcomeMessage = !isHeaderLine
          return createElement(
            Text,
            {
              key: i,
              color: isWelcomeMessage ? '#86EFAC' : undefined,
            },
            item,
          )
        },
      ),
    ),

    // Readonly gray input box with command log (shown only after first command executed).
    hasExecutedCommand
      ? createElement(
          Box,
          {
            borderBottom: true,
            borderColor: focused === 'gray' ? '#7B5FBF' : '#3F3F3F',
            borderLeft: true,
            borderRight: true,
            borderStyle: 'single',
            borderTop: true,
            flexDirection: 'column',
            flexGrow: 0,
            flexShrink: 0,
            height: Math.max(5, Math.min(Math.floor(consoleHeight * 0.85), 25)),
            paddingX: 1,
            paddingY: 0,
          },
          // Check if showing default text.
          (() => {
            const nonEmptyMessages = messages.filter(msg => msg.text.length > 0)
            if (nonEmptyMessages.length === 0) {
              return createElement(
                Text,
                { color: focused === 'gray' ? '#B0B0B0' : '#5A5A5A' },
                'Waiting for command output…',
              )
            }

            // Apply scroll offset: show messages from start up to (length - offset).
            // Limit to max 21 visible messages to prevent height overflow.
            const maxVisibleMessages = 21
            const visibleMessages = nonEmptyMessages.slice(
              Math.max(
                0,
                nonEmptyMessages.length -
                  maxVisibleMessages -
                  grayBoxScrollOffset,
              ),
              nonEmptyMessages.length - grayBoxScrollOffset,
            )
            const currentPosition = Math.max(
              1,
              nonEmptyMessages.length - grayBoxScrollOffset,
            )
            const totalMessages = nonEmptyMessages.length

            return createElement(
              Box,
              {
                flexDirection: 'column',
                flexShrink: 0,
                height: '100%',
                minWidth: 0,
              },
              // Scrollable content area (grows to fill available space).
              createElement(
                Box,
                { flexDirection: 'column', flexGrow: 1, minWidth: 0 },
                ...visibleMessages.map((msg, i) => {
                  const isCommandOutput =
                    !msg.text.startsWith('>') &&
                    !msg.text.includes('→') &&
                    !msg.text.includes('✓') &&
                    !msg.text.includes('✗')
                  const isFocused = focused === 'gray'
                  return createElement(
                    Text,
                    {
                      key: i,
                      color: isFocused
                        ? isCommandOutput
                          ? '#86EFAC'
                          : '#B0B0B0'
                        : isCommandOutput
                          ? '#86EFAC'
                          : '#5A5A5A',
                    },
                    msg.text,
                  )
                }),
              ),
              // Footer with scroll position indicator and navigation hint (stays at bottom).
              createElement(
                Box,
                {
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  width: '100%',
                },
                createElement(
                  Text,
                  { color: focused === 'gray' ? '#7B5FBF' : '#3A3A3A' },
                  `[${currentPosition}/${totalMessages}]`,
                ),
                createElement(
                  Text,
                  { color: focused === 'gray' ? '#7B5FBF' : '#3A3A3A' },
                  '↑/↓',
                ),
              ),
            )
          })(),
        )
      : null,

    // Input at bottom.
    createElement(InputArea, {
      commandHistory,
      height: inputHeight,
      isFocused: focused === 'input',
      onHeightChange: handleInputHeightChange,
      onSubmit: handleInputSubmit,
    }),

    // Status bar at very bottom.
    createElement(StatusBar, { ctrlCPressed }),
  )
}

// Export memoized version to prevent unnecessary re-renders.
export const InteractiveConsoleApp = memo(InteractiveConsoleAppComponent)
