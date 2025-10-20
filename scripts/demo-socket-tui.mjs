#!/usr/bin/env node
/** @fileoverview Socket CLI TUI using Ink framework - pure JS version. */

import React, { useState, useEffect, useMemo } from 'react'
import { Box, Text, render, useApp, useInput, useStdout } from 'ink'
import { spawn } from '@socketsecurity/registry/lib/spawn'
import terminalLink from 'terminal-link'

const { createElement: h } = React

// ASCII Logo.
const SOCKET_LOGO = [
  '   _____         _       _       ',
  '  |   __|___ ___| |_ ___| |_     ',
  '  |__   | . |  _| \'_| -_|  _|    ',
  '  |_____|___|___|_,_|___|_|.dev  ',
]

// Themes.
const THEMES = {
  socket: {
    name: 'Socket',
    accent: '#8B5CF6',
    success: '#86EFAC',
    dim: '#9CA3AF',
    frame: '#6B7280',
    scrollbar: '#4B5563',
    themeKey: 'default',
    emoji: '',
  },
  coana: {
    name: 'Coana',
    accent: '#EA580C',
    success: '#86EFAC',
    dim: '#9CA3AF',
    frame: '#92400E',
    scrollbar: '#78350F',
    themeKey: 'sunset',
    emoji: '',
  },
  python: {
    name: 'Python',
    accent: '#2563EB',
    success: '#86EFAC',
    dim: '#9CA3AF',
    frame: '#1E40AF',
    scrollbar: '#1E3A8A',
    themeKey: 'ocean',
    emoji: '🐍',
  },
  sfw: {
    name: 'Firewall',
    accent: '#DC2626',
    success: '#86EFAC',
    dim: '#9CA3AF',
    frame: '#991B1B',
    scrollbar: '#7F1D1D',
    themeKey: 'sunset',
    emoji: '🔥',
  },
}

/**
 * Detect and highlight URLs in text.
 */
function highlightLinks(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g
  const parts = []
  let lastIndex = 0
  let match

  while ((match = urlRegex.exec(text)) !== null) {
    // Add text before URL.
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index))
    }
    // Add linked URL.
    parts.push(terminalLink(match[0], match[0], { fallback: () => match[0] }))
    lastIndex = match.index + match[0].length
  }

  // Add remaining text.
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex))
  }

  return parts.length > 0 ? parts.join('') : text
}

/**
 * Render a scroll indicator bar.
 */
function ScrollIndicator({ current, total, height, theme }) {
  if (total <= height) {
    return null
  }

  const scrollPercentage = current / (total - height)
  const indicatorPosition = Math.floor(scrollPercentage * (height - 1))

  const bars = []
  for (let i = 0; i < height; i++) {
    bars.push(
      h(
        Text,
        { key: `scroll-${i}`, color: i === indicatorPosition ? theme.accent : theme.scrollbar },
        i === indicatorPosition ? '█' : '│'
      )
    )
  }

  return h(Box, { flexDirection: 'column' }, ...bars)
}

/**
 * Main TUI application component.
 */
function App() {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [theme, setTheme] = useState('socket')
  const [input, setInput] = useState('')
  const [multilineMode, setMultilineMode] = useState(false)
  const [output, setOutput] = useState([
    { type: 'info', text: 'Socket CLI v1.0.80' },
    { type: 'info', text: '' },
    { type: 'info', text: 'Welcome to Socket CLI!' },
    { type: 'info', text: 'Type commands below...' },
    { type: 'info', text: '' },
    { type: 'info', text: 'Try shell commands like: ls, echo "hello", node --version' },
  ])
  const [commandHistory, setCommandHistory] = useState([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [outputScroll, setOutputScroll] = useState(0)
  const [focusedPanel, setFocusedPanel] = useState('input')
  const [frameCount, setFrameCount] = useState(0)
  const [statusMessage, setStatusMessage] = useState('')
  const [ctrlCPressed, setCtrlCPressed] = useState(false)
  const [ctrlCTimer, setCtrlCTimer] = useState(null)
  const [collapsedErrors, setCollapsedErrors] = useState(new Set())
  const [isExecuting, setIsExecuting] = useState(false)
  const [executingVerb, setExecutingVerb] = useState('Processing')

  const currentTheme = THEMES[theme]

  // Calculate available height for output panel (memoized to prevent flicker).
  // Terminal height - logo (4 lines) - info (1 line) - input (3 lines for border) - status (1 line) - borders (4 lines)
  const dimensions = useMemo(() => {
    const terminalHeight = stdout?.rows || 24
    const terminalWidth = stdout?.columns || 80
    const maxOutputLines = Math.max(5, terminalHeight - 13)
    return { width: terminalWidth, height: terminalHeight, maxOutputLines }
  }, [stdout?.rows, stdout?.columns])

  const maxOutputLines = dimensions.maxOutputLines

  // Executing verbs for variety.
  const EXECUTING_VERBS = [
    'Analyzing',
    'Processing',
    'Executing',
    'Running',
    'Compiling',
    'Building',
    'Scanning',
    'Searching',
    'Loading',
    'Fetching',
  ]

  // Frame counter (only when executing to reduce flicker).
  useEffect(() => {
    if (!isExecuting) {
      return
    }
    const interval = setInterval(() => {
      setFrameCount(prev => prev + 1)
    }, 100)
    return () => clearInterval(interval)
  }, [isExecuting])

  // Clear screen on resize.
  useEffect(() => {
    const handleResize = () => {
      // Clear screen completely.
      process.stdout.write('\x1B[2J\x1B[H')
    }

    process.stdout.on('resize', handleResize)
    return () => {
      process.stdout.off('resize', handleResize)
    }
  }, [])

  // Clear status message after 2 seconds.
  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => {
        setStatusMessage('')
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [statusMessage])

  useInput((inputChar, key) => {
    // Ctrl+O to toggle error expansion.
    if (key.ctrl && inputChar === 'o') {
      // Find the last error in output.
      for (let i = output.length - 1; i >= 0; i--) {
        if (output[i].type === 'error' && output[i].id) {
          const errorId = output[i].id
          setCollapsedErrors(prev => {
            const next = new Set(prev)
            if (next.has(errorId)) {
              next.delete(errorId)
            } else {
              next.add(errorId)
            }
            return next
          })
          break
        }
      }
      return
    }

    // Alt+Enter for multiline mode.
    if (key.meta && key.return) {
      setMultilineMode(prev => !prev)
      return
    }

    // Ctrl+C handling with warning.
    if (key.ctrl && inputChar === 'c') {
      if (ctrlCPressed) {
        // Second press - exit.
        exit()
        return
      }

      // First press - show warning.
      setCtrlCPressed(true)
      setStatusMessage('⚠️  Press Ctrl+C again to exit')

      // Reset after 2 seconds.
      if (ctrlCTimer) {
        clearTimeout(ctrlCTimer)
      }
      const timer = setTimeout(() => {
        setCtrlCPressed(false)
        setStatusMessage('')
      }, 2000)
      setCtrlCTimer(timer)
      return
    }

    // Quit on Ctrl+D.
    if (key.ctrl && inputChar === 'd') {
      exit()
      return
    }

    // Theme switcher with Ctrl+T.
    if (key.ctrl && inputChar === 't') {
      const themeKeys = Object.keys(THEMES)
      const currentIndex = themeKeys.indexOf(theme)
      const nextIndex = (currentIndex + 1) % themeKeys.length
      setTheme(themeKeys[nextIndex])
      return
    }

    // Panel focus with Tab.
    if (key.tab) {
      setFocusedPanel(prev => (prev === 'input' ? 'output' : 'input'))
      return
    }

    // Arrow key handling.
    if (key.upArrow) {
      if (focusedPanel === 'output') {
        setOutputScroll(prev => Math.max(0, prev - 1))
      } else if (commandHistory.length > 0 && !multilineMode) {
        const newIndex =
          historyIndex === -1 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1)
        setHistoryIndex(newIndex)
        setInput(commandHistory[newIndex])
      }
      return
    }

    if (key.downArrow) {
      if (focusedPanel === 'output') {
        setOutputScroll(prev => Math.max(0, Math.min(output.length - maxOutputLines, prev + 1)))
      } else if (historyIndex !== -1 && !multilineMode) {
        const newIndex = historyIndex + 1
        if (newIndex >= commandHistory.length) {
          setHistoryIndex(-1)
          setInput('')
        } else {
          setHistoryIndex(newIndex)
          setInput(commandHistory[newIndex])
        }
      }
      return
    }

    // Page Up/Down for faster scrolling.
    if (key.pageUp && focusedPanel === 'output') {
      setOutputScroll(prev => Math.max(0, prev - 5))
      return
    }

    if (key.pageDown && focusedPanel === 'output') {
      setOutputScroll(prev => Math.max(0, Math.min(output.length - maxOutputLines, prev + 5)))
      return
    }

    // Enter to execute command (or add newline in multiline mode).
    if (key.return) {
      if (multilineMode) {
        // In multiline mode, plain Enter submits.
        if (input.trim()) {
          executeCommandWrapper(input.trim())
          setMultilineMode(false)
        }
      } else if (input.trim()) {
        executeCommandWrapper(input.trim())
      }
      return
    }

    // Backspace.
    if (key.backspace || key.delete) {
      setInput(prev => prev.slice(0, -1))
      return
    }

    // Regular character input.
    if (!key.ctrl && !key.meta && inputChar.length === 1) {
      setInput(prev => prev + inputChar)
    }
  })

  /**
   * Wrapper to execute command and update UI.
   */
  function executeCommandWrapper(cmd) {
    // Add command to output.
    setOutput(prev => [...prev, { type: 'command', text: `> ${cmd}` }])
    setCommandHistory(prev => [...prev, cmd])
    setHistoryIndex(-1)
    setInput('')

    // Handle built-in commands.
    if (cmd === 'clear') {
      setOutput([{ type: 'info', text: 'Socket CLI v1.0.80' }, { type: 'info', text: '' }, { type: 'info', text: 'Output cleared.' }])
      setOutputScroll(0)
      return
    }

    if (cmd === 'help') {
      setOutput(prev => [
        ...prev,
        { type: 'info', text: 'Socket CLI TUI - Execute shell commands' },
        { type: 'info', text: 'Built-in commands:' },
        { type: 'info', text: '  clear - Clear output' },
        { type: 'info', text: '  help - Show this help' },
        { type: 'info', text: '' },
        { type: 'info', text: 'All other commands are executed as shell commands.' },
        { type: 'info', text: '' },
      ])
      setTimeout(() => setOutputScroll(output.length + 10), 0)
      return
    }

    // Execute shell command.
    executeCommand(cmd)
  }

  /**
   * Execute a shell command and capture stdout/stderr.
   */
  async function executeCommand(cmd) {
    // Pick a random executing verb.
    const verb = EXECUTING_VERBS[Math.floor(Math.random() * EXECUTING_VERBS.length)]
    setExecutingVerb(verb)
    setIsExecuting(true)

    try {
      // Parse command and args.
      const parts = cmd.match(/(?:[^\s"]+|"[^"]*")+/g) || []
      const command = parts[0]
      const args = parts.slice(1).map(arg => arg.replace(/^"|"$/g, ''))

      // Spawn process.
      const result = await spawn(command, args, {
        stdio: 'pipe',
        shell: false,
      })

      // Hide spinner.
      setIsExecuting(false)

      // Add stdout to output (green, with links).
      if (result.stdout) {
        const lines = result.stdout.trim().split('\n')
        setOutput(prev => [...prev, ...lines.map(line => ({ type: 'stdout', text: line })), { type: 'stdout', text: '' }])
      }

      // Add stderr to output (collapsible).
      if (result.stderr) {
        const errorId = `error-${Date.now()}`
        const lines = result.stderr.trim().split('\n')
        setOutput(prev => [
          ...prev,
          { type: 'error', text: `[stderr] ${lines[0]}`, id: errorId, fullText: lines },
          { type: 'stderr', text: '' },
        ])
        setCollapsedErrors(prev => new Set([...prev, errorId]))
      }

      // Show exit code if non-zero.
      if (result.code !== 0) {
        setOutput(prev => [...prev, { type: 'error', text: `[exit code: ${result.code}]` }, { type: 'error', text: '' }])
      }

      // Auto-scroll to bottom.
      setTimeout(() => {
        setOutputScroll(output.length + 10)
      }, 0)
    } catch (e) {
      setIsExecuting(false)
      setOutput(prev => [...prev, { type: 'error', text: `Error: ${e.message}` }, { type: 'error', text: '' }])
      setTimeout(() => {
        setOutputScroll(output.length + 2)
      }, 0)
    }
  }

  // Calculate visible output lines.
  const expandedOutput = []
  for (const item of output) {
    if (item.type === 'error' && item.id && !collapsedErrors.has(item.id) && item.fullText) {
      // Expand error.
      for (const line of item.fullText) {
        expandedOutput.push({ type: 'error', text: `[stderr] ${line}` })
      }
    } else if (item.type === 'error' && item.id && collapsedErrors.has(item.id)) {
      // Show collapsed with indicator.
      expandedOutput.push({ type: 'error', text: `${item.text} (Ctrl+O to expand)` })
    } else {
      expandedOutput.push(item)
    }
  }

  const visibleOutput = expandedOutput.slice(
    Math.max(0, outputScroll),
    Math.max(0, outputScroll) + maxOutputLines
  )

  // Render logo with emoji.
  const logoLines = [...SOCKET_LOGO]

  // Add emoji after .dev if theme has one (last line of logo).
  if (currentTheme.emoji && logoLines.length > 0) {
    const lastLineIndex = logoLines.length - 1
    logoLines[lastLineIndex] = logoLines[lastLineIndex] + `  ${currentTheme.emoji}`
  }

  // Spinner frames.
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  const spinnerFrame = spinnerFrames[Math.floor(frameCount / 2) % spinnerFrames.length]

  // Info bar text with spinner.
  const infoText = isExecuting
    ? `${spinnerFrame} ${executingVerb}... │ ${currentTheme.name} Theme`
    : `Socket CLI v1.0.80 │ ${currentTheme.name} Theme`

  // History indicator.
  const historyText =
    commandHistory.length > 0
      ? `↑↓ History: ${commandHistory.length} commands`
      : 'No command history'

  // Status bar text with focus hints.
  let statusBarText = statusMessage
  if (!statusMessage) {
    if (multilineMode) {
      statusBarText = 'Multi-line Mode (Enter to submit) │ Ctrl+T: Theme │ Tab: Switch │ Ctrl+C: Quit'
    } else if (focusedPanel === 'output') {
      statusBarText = `↑↓ Scroll │ PgUp/PgDn: Fast Scroll │ Tab: Switch to Input │ ${historyText} │ Ctrl+C: Quit`
    } else {
      statusBarText = `${historyText} │ Tab: Switch to Output │ Ctrl+T: Theme │ Ctrl+O: Toggle Error │ Ctrl+C: Quit`
    }
  }

  // Input lines for multiline.
  const inputLines = multilineMode ? input.split('\n') : [input]

  return h(
    Box,
    {
      flexDirection: 'column',
      width: dimensions.width,
      height: dimensions.height,
    },
    // Header with logo and info.
    h(
      Box,
      {
        flexDirection: 'column',
        paddingX: 1,
      },
      ...logoLines.map((line, i) =>
        h(Text, { key: `logo-${i}`, color: currentTheme.accent, bold: true }, line)
      ),
      h(Text, { color: currentTheme.accent }, infoText)
    ),
    // Output panel with scrollbar.
    h(
      Box,
      {
        flexDirection: 'row',
        height: maxOutputLines + 2,
        borderStyle: 'round',
        borderColor: focusedPanel === 'output' ? currentTheme.accent : currentTheme.dim,
      },
      // Output content.
      h(
        Box,
        {
          flexDirection: 'column',
          flexGrow: 1,
          paddingX: 1,
          paddingY: 0,
        },
        h(
          Text,
          { color: focusedPanel === 'output' ? currentTheme.accent : currentTheme.dim },
          '[ $ output ]'
        ),
        h(
          Box,
          { flexDirection: 'column', marginTop: 1 },
          ...visibleOutput.map((item, i) => {
            let color = currentTheme.dim
            let text = item.text

            if (item.type === 'stdout') {
              color = currentTheme.success
              text = highlightLinks(item.text)
            } else if (item.type === 'error' || item.type === 'stderr') {
              color = '#EF4444'
            } else if (item.type === 'command') {
              color = currentTheme.accent
            }

            return h(Text, { key: `output-${outputScroll}-${i}`, color }, text)
          })
        ),
        expandedOutput.length > maxOutputLines &&
          h(
            Text,
            { color: currentTheme.dim },
            `[${Math.min(outputScroll + maxOutputLines, expandedOutput.length)}/${expandedOutput.length}]`
          )
      ),
      // Scroll indicator.
      h(
        Box,
        { flexDirection: 'column', paddingY: 1, paddingRight: 1 },
        h(ScrollIndicator, {
          current: outputScroll,
          total: expandedOutput.length,
          height: maxOutputLines,
          theme: currentTheme,
        })
      )
    ),
    // Input textarea.
    h(
      Box,
      {
        flexDirection: 'column',
        paddingX: 1,
        paddingY: 0,
        borderStyle: 'round',
        borderColor: focusedPanel === 'input' ? currentTheme.accent : currentTheme.dim,
        borderTop: false,
      },
      ...inputLines.map((line, i) =>
        h(
          Text,
          { key: `input-${i}`, color: focusedPanel === 'input' ? currentTheme.accent : currentTheme.dim },
          i === inputLines.length - 1 ? `> ${line}▌` : `> ${line}`
        )
      )
    ),
    // Status bar.
    h(
      Box,
      { paddingX: 1 },
      h(
        Text,
        { color: statusMessage ? '#FBBF24' : currentTheme.dim, bold: !!statusMessage },
        statusBarText
      )
    )
  )
}

// Render the app.
render(h(App))
