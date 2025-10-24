import { render } from 'ink'
import { createElement } from 'react'

import type { ParsedIntent } from '../ask/handle-ask.mts'
import { parseIntent } from '../ask/handle-ask.mts'
import type { ConsoleMessage } from './InteractiveConsoleApp.js'
import { createFileDiff, createPackageChangeDiff, InteractiveConsoleApp } from './InteractiveConsoleApp.js'
import { spawn } from '@socketsecurity/lib/spawn'

import colors from 'yoctocolors-cjs'

// Read package.json for version info.
async function getVersionInfo(): Promise<{
  version: string
  buildHash?: string
  devMode: boolean
}> {
  try {
    const pkgPath = new URL('../../../package.json', import.meta.url)
    const { default: pkg } = await import(pkgPath.href, {
      with: { type: 'json' },
    })
    return {
      buildHash: process.env['SOCKET_CLI_BUILD_HASH'] || 'local',
      devMode: process.env['NODE_ENV'] === 'development',
      version: pkg.version || 'dev',
    }
  } catch (_e) {
    return {
      buildHash: 'local',
      devMode: true,
      version: 'dev',
    }
  }
}

/**
 * Set up raw mode for keyboard input (without mouse tracking).
 * Note: Mouse tracking is incompatible with terminal text selection.
 * Use Tab to switch focus instead of clicking.
 */
function setupRawMode(): void {
  // Note: Ink handles keyboard input via useInput, so raw mode setup is minimal.
  // The terminal is already in the right state for Ink's input handling.
  // This function is kept for potential future extensions.
}

/**
 * Restore terminal to normal mode.
 */
function restoreTerminalMode(): void {
  // Terminal restoration is handled by Ink automatically.
  // This function is kept for potential future extensions.
}

/**
 * Handle console command - launches interactive TUI.
 */
export async function handleConsole(): Promise<void> {
  // Switch to alternate screen buffer and hide cursor.
  process.stdout.write('\x1B[?1049h\x1B[?25l')

  // Set up raw mode and mouse tracking.
  setupRawMode()

  // Get version info.
  const versionInfo = await getVersionInfo()

  // Command handler - executes both console commands and socket commands.
  const handleCommand = async (command: string, addMessage: (textOrMessage: string | ConsoleMessage) => void) => {
    try {
      // Special demo commands.
      if (command.trim() === 'demo diff') {
        addMessage(`${colors.cyan('→')} Demo: Socket optimize preview`)
        addMessage('')

        // Simulate package.json before optimization.
        const beforePackageJson = `{
  "name": "my-app",
  "version": "1.0.0",
  "dependencies": {
    "lodash": "^4.17.21",
    "moment": "^2.29.4",
    "chalk": "^4.1.2"
  }
}`

        // Simulate package.json after optimization.
        const afterPackageJson = `{
  "name": "my-app",
  "version": "1.0.0",
  "dependencies": {
    "lodash-es": "^4.17.21",
    "date-fns": "^3.0.0",
    "@socketsecurity/registry#chalk": "^5.3.0"
  }
}`

        const diffLines = createFileDiff(beforePackageJson, afterPackageJson)

        // Add message with diff.
        addMessage({
          diff: diffLines,
          text: '📦 package.json',
          timestamp: new Date(),
        })

        addMessage('')
        addMessage({ dimmed: true, text: `  ${colors.dim('lodash → lodash-es (tree-shakeable, saves ~45KB)')}`, timestamp: new Date() })
        addMessage({ dimmed: true, text: `  ${colors.dim('moment → date-fns (smaller bundle, better tree-shaking)')}`, timestamp: new Date() })
        addMessage({ dimmed: true, text: `  ${colors.dim('chalk → @socketsecurity/registry#chalk (Socket registry, verified safe)')}`, timestamp: new Date() })
        addMessage('')
        addMessage(`${colors.green('✓')} Demo completed`)
        addMessage('')
        return
      }

      // Parse command.
      const args = command.trim().split(/\s+/)
      if (args.length === 0) {
        return
      }

      const firstArg = args[0]!

      // Determine if this is a socket command or console command.
      const socketCommands = [
        'analytics',
        'audit-log',
        'ci',
        'config',
        'fix',
        'install',
        'login',
        'logout',
        'manifest',
        'npm',
        'npx',
        'optimize',
        'organization',
        'package',
        'patch',
        'pip',
        'pnpm',
        'repository',
        'scan',
        'threat-feed',
        'uninstall',
        'whoami',
        'wrapper',
        'yarn',
      ]

      // Common console commands that should execute directly.
      const consoleCommands = [
        'ls', 'pwd', 'cd', 'echo', 'cat', 'grep', 'find', 'ps', 'top',
        'kill', 'env', 'export', 'alias', 'history', 'clear', 'exit',
        'mkdir', 'rm', 'cp', 'mv', 'touch', 'chmod', 'chown', 'which',
        'curl', 'wget', 'git', 'node', 'npm', 'pnpm', 'yarn',
      ]

      let isSocketCommand = socketCommands.includes(firstArg)
      const isConsoleCommand = consoleCommands.includes(firstArg)

      // If not a known command, try AI parsing for natural language.
      if (!isSocketCommand && !isConsoleCommand) {
        try {
          const intent = await parseIntent(command)
          // Only use AI if confidence is high.
          if (intent && intent.confidence > 0.6) {
            addMessage(`${colors.blue('ℹ')} Interpreted as: ${intent.explanation} (${Math.round(intent.confidence * 100)}% confident)`)
            isSocketCommand = true
            // Use AI-parsed command.
            args.length = 0
            args.push(...intent.command)
          }
        } catch (e) {
          // AI parsing failed, continue with direct command.
        }
      }

      if (isSocketCommand) {
        // Execute as socket command.
        addMessage(`${colors.cyan('→')} Executing: socket ${args.join(' ')}`)

        const result = await spawn('socket', args, {
          cwd: process.cwd(),
          stdio: 'pipe',
        })

        // Add stdout output.
        if (result.stdout) {
          const lines = result.stdout.trim().split('\n')
          for (const line of lines) {
            addMessage(line)
          }
        }

        // Add stderr output.
        if (result.stderr) {
          const lines = result.stderr.trim().split('\n')
          for (const line of lines) {
            addMessage(`${colors.red('✗')} ${line}`)
          }
        }

        if (result.code !== 0) {
          addMessage(`${colors.red('✗')} Command failed with exit code ${result.code}`)
        } else {
          addMessage(`${colors.green('✓')} Command completed successfully`)
        }
      } else {
        // Execute as console command (ls, pwd, etc).
        addMessage(`${colors.cyan('→')} Executing: ${command}`)

        const result = await spawn(firstArg, args.slice(1), {
          cwd: process.cwd(),
          stdio: 'pipe',
        })

        // Add stdout output.
        if (result.stdout) {
          const lines = result.stdout.trim().split('\n')
          for (const line of lines) {
            addMessage(line)
          }
        }

        // Add stderr output.
        if (result.stderr) {
          const lines = result.stderr.trim().split('\n')
          for (const line of lines) {
            addMessage(`${colors.red('✗')} ${line}`)
          }
        }

        if (result.code !== 0) {
          addMessage(`${colors.red('✗')} Command failed with exit code ${result.code}`)
        } else {
          addMessage(`${colors.green('✓')} Command completed`)
        }
      }

      // Add spacing after command output.
      addMessage('')
    } catch (e) {
      addMessage(`${colors.red('✗')} Error executing command: ${(e as Error).message}`)
      addMessage('')
    }
  }

  // Render the interactive console with Ctrl+C handling disabled (we handle it ourselves).
  const renderInstance = render(
    createElement(InteractiveConsoleApp, {
      ...versionInfo,
      onCommand: handleCommand,
    }),
    {
      exitOnCtrlC: false,
      patchConsole: false,
      debug: false,
    },
  )

  // Wait for exit.
  try {
    await renderInstance.waitUntilExit()
  } finally {
    renderInstance.unmount()
    // Restore terminal mode and show cursor and exit alternate screen.
    restoreTerminalMode()
    process.stdout.write('\x1B[?25h\x1B[?1049l')
  }
}
