/** @fileoverview Interactive expand/collapse feature with ctrl+o support */

import { stdin, stdout } from 'node:process'

import { getTheme } from './theme.mts'

export interface ExpandableContent {
  summary: string
  details: string
  expanded?: boolean
  showHint?: boolean
}

/**
 * Format content with expand/collapse hint
 */
export function formatExpandable(
  summary: string,
  details?: string,
  options: {
    expanded?: boolean
    showHint?: boolean
    expandText?: string
  } = {}
): string {
  const theme = getTheme()
  const { expandText = 'expand', expanded = false, showHint = true } = options

  if (!details) {
    return summary
  }

  if (expanded) {
    return `${summary}\n${details}`
  }

  if (showHint) {
    return `${summary} ${theme.dim(`(ctrl+o to ${expandText})`)}`
  }

  return summary
}

/**
 * Interactive expandable section manager
 */
export class ExpandableSection {
  private expanded: boolean = false
  private listener?: any
  private summary: string
  private details: string
  private options: {
    expandText?: string
    collapseText?: string
    onToggle?: (expanded: boolean) => void
  }

  constructor(
    summary: string,
    details: string,
    options: {
      expandText?: string
      collapseText?: string
      onToggle?: (expanded: boolean) => void
    } = {}
  ) {
    this.summary = summary
    this.details = details
    this.options = options
  }

  /**
   * Display the expandable content
   */
  display(): void {
    const content = formatExpandable(this.summary, this.details, {
      expanded: this.expanded,
      expandText: this.expanded ? this.options.collapseText || 'collapse' : this.options.expandText || 'expand'
    })

    // Clear current line and redraw
    stdout.write('\r\x1b[K')
    stdout.write(content)

    if (!this.expanded && this.details) {
      this.setupKeyListener()
    }
  }

  /**
   * Setup keyboard listener for ctrl+o
   */
  private setupKeyListener(): void {
    if (this.listener) {return}

    // Check if stdin is a TTY before setting raw mode
    if (!stdin.isTTY) {
      return
    }

    try {
      stdin.setRawMode(true)
      stdin.resume()
      stdin.setEncoding('utf8')

      this.listener = (key: string) => {
        // Ctrl+O (ASCII 15)
        if (key === '\x0f') {
          this.toggle()
        }
        // Ctrl+C (exit) - set exit code instead of calling process.exit()
        else if (key === '\x03') {
          this.cleanup()
          // Standard SIGINT exit code
          process.exitCode = 130
          // Emit SIGINT to allow proper cleanup
          process.emit('SIGINT' as any)
        }
      }

      stdin.on('data', this.listener)
    } catch (error) {
      // If setting raw mode fails, just skip interactive features
      this.listener = null
    }
  }

  /**
   * Toggle expanded state
   */
  toggle(): void {
    this.expanded = !this.expanded
    this.display()

    if (this.options.onToggle) {
      this.options.onToggle(this.expanded)
    }

    if (!this.expanded) {
      this.cleanup()
    }
  }

  /**
   * Cleanup listeners
   */
  cleanup(): void {
    if (this.listener) {
      try {
        stdin.removeListener('data', this.listener)
        // Only restore if stdin is still a TTY
        if (stdin.isTTY && stdin.setRawMode) {
          stdin.setRawMode(false)
        }
        stdin.pause()
      } catch (error) {
        // Ignore cleanup errors
      } finally {
        this.listener = null
      }
    }
  }
}

/**
 * Display error with expandable details
 */
export function displayExpandableError(
  message: string,
  details?: string,
  options: {
    autoExpand?: boolean
    showStackTrace?: boolean
  } = {}
): void {
  const theme = getTheme()

  if (!details || options.autoExpand) {
    console.error(theme.error(message))
    if (details) {
      console.error(theme.dim(details))
    }
    return
  }

  const section = new ExpandableSection(
    theme.error(message),
    theme.dim(details),
    {
      expandText: 'show details',
      collapseText: 'hide details'
    }
  )

  section.display()

  // Auto-cleanup after a timeout if not expanded
  const cleanupTimer = setTimeout(() => {
    section.cleanup()
  }, 10000)

  // Clear timeout if process exits
  process.once('exit', () => {
    clearTimeout(cleanupTimer)
    section.cleanup()
  })

  // Also cleanup on SIGINT
  process.once('SIGINT', () => {
    clearTimeout(cleanupTimer)
    section.cleanup()
  })
}

/**
 * Display warning with expandable details
 */
export function displayExpandableWarning(
  message: string,
  details?: string
): void {
  const theme = getTheme()

  if (!details) {
    console.warn(theme.warning(message))
    return
  }

  console.warn(formatExpandable(
    theme.warning(message),
    theme.dim(details),
    { showHint: true }
  ))
}

/**
 * Display info with expandable details
 */
export function displayExpandableInfo(
  message: string,
  details?: string
): void {
  const theme = getTheme()

  if (!details) {
    console.log(theme.info(message))
    return
  }

  console.log(formatExpandable(
    theme.info(message),
    details,
    { showHint: true }
  ))
}

/**
 * Create expandable list
 */
export function formatExpandableList(
  title: string,
  items: string[],
  options: {
    maxItemsCollapsed?: number
    expanded?: boolean
  } = {}
): string {
  const theme = getTheme()
  const { expanded = false, maxItemsCollapsed = 3 } = options

  if (items.length <= maxItemsCollapsed || expanded) {
    const list = items.map(item => `  • ${item}`).join('\n')
    return `${title}\n${list}`
  }

  const visibleItems = items.slice(0, maxItemsCollapsed)
  const hiddenCount = items.length - maxItemsCollapsed
  const summary = `${title}\n${visibleItems.map(item => `  • ${item}`).join('\n')}`
  const moreText = `  ... and ${hiddenCount} more`

  return formatExpandable(
    `${summary}\n${theme.dim(moreText)}`,
    items.slice(maxItemsCollapsed).map(item => `  • ${item}`).join('\n'),
    { expandText: 'show all' }
  )
}

/**
 * Format error with stack trace
 */
export function formatErrorWithStack(
  error: Error | unknown,
  options: {
    showStack?: boolean
    expanded?: boolean
  } = {}
): string {
  const theme = getTheme()
  const err = error instanceof Error ? error : new Error(String(error))
  const message = theme.error(err.message || 'Unknown error')

  if (!options.showStack || !err.stack) {
    return message
  }

  // Extract stack trace (remove first line which is the message)
  const stackLines = err.stack.split('\n').slice(1)
  const stack = stackLines.join('\n')

  return formatExpandable(
    message,
    theme.dim(stack),
    {
      expanded: options.expanded ?? false,
      expandText: 'show stack trace'
    }
  )
}