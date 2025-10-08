/**
 * @fileoverview Internal theme system for Socket CLI.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import colors from 'yoctocolors-cjs'

/**
 * Theme interface
 */
export interface Theme {
  name: string
  description: string

  // Primary colors
  primary: (text: string) => string
  primaryBold: (text: string) => string
  secondary: (text: string) => string
  accent: (text: string) => string

  // Status colors
  success: (text: string) => string
  warning: (text: string) => string
  error: (text: string) => string
  info: (text: string) => string

  // Text variations
  muted: (text: string) => string
  dim: (text: string) => string
  bold: (text: string) => string

  // Special elements
  heading: (text: string) => string
  subheading: (text: string) => string
  command: (text: string) => string
  code: (text: string) => string
  link: (text: string) => string

  // Icons
  icons: {
    checkmark: string
    cross: string
    arrow: string
    bullet: string
    star: string
    warning: string
    info: string
    // Allow additional icons
    [key: string]: string
  }

  // Progress indicators
  spinner: (text: string) => string
  progressBar: (text: string) => string

  // Interactive elements
  prompt: (text: string) => string
  input: (text: string) => string
  selection: (text: string) => string

  // Table styling
  tableHeader: (text: string) => string
  tableRow: (text: string) => string
  tableBorder: (text: string) => string

  // Severity levels
  severity: {
    critical: (text: string) => string
    high: (text: string) => string
    medium: (text: string) => string
    low: (text: string) => string
  }

  // Special formatting
  highlight: (text: string) => string
  expandHint: (text: string) => string
}

/**
 * Theme configuration from JSON
 */
interface ThemeConfig {
  defaultTheme: string
  contextThemes: {
    python: string
    firewall: string
    coana: string
    default: string
  }
  themes: Record<string, ThemeDefinition>
  transitions: {
    enabled: boolean
    duration: number
    animations: Record<string, { enterMessage: string; exitMessage: string }>
  }
}

interface ThemeDefinition {
  name: string
  description: string
  colors: Record<string, string>
  elements: Record<string, string>
  icons: Record<string, string>
  severity: Record<string, string>
}

/**
 * Load themes configuration
 */
function loadThemesConfig(): ThemeConfig {
  try {
    // Try to find themes.json relative to this module
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)

    // Look for themes.json in the package root
    const themesPath = join(__dirname, '..', '..', '..', 'themes.json')
    const content = readFileSync(themesPath, 'utf8')
    return JSON.parse(content)
  } catch {
    // Fallback to default config if file not found
    return {
      defaultTheme: 'purple',
      contextThemes: {
        python: 'green',
        firewall: 'brick',
        coana: 'purple',
        default: 'purple',
      },
      themes: {
        purple: {
          name: 'purple',
          description: 'Socket brand purple theme',
          colors: {
            primary: 'magenta',
            primaryBold: 'bold:magenta',
            secondary: 'blue',
            accent: 'cyan',
            success: 'green',
            warning: 'yellow',
            error: 'red',
            info: 'blue',
            muted: 'gray',
            dim: 'dim',
            bold: 'bold',
          },
          elements: {
            heading: 'bold:magenta',
            subheading: 'magenta',
            command: 'cyan',
            code: 'blue',
            link: 'underline:blue',
          },
          icons: {
            checkmark: '✓',
            cross: '✗',
            arrow: '→',
            bullet: '•',
            star: '★',
            warning: '⚠',
            info: 'ℹ',
          },
          severity: {
            critical: 'red',
            high: 'magenta',
            medium: 'yellow',
            low: 'blue',
          },
        },
      },
      transitions: {
        enabled: true,
        duration: 500,
        animations: {
          python: {
            enterMessage: '🐍 Entering Python context...',
            exitMessage: '↩️ Returning to Socket CLI...',
          },
          firewall: {
            enterMessage: '🔥 Activating Socket Firewall...',
            exitMessage: '↩️ Security scan complete...',
          },
        },
      },
    }
  }
}

/**
 * Parse color string to function
 */
function parseColorFunction(colorStr: string): (text: string) => string {
  if (!colorStr) {
    return (text: string) => text
  }

  // Handle special cases
  if (colorStr === 'dim') {
    return colors.dim
  }
  if (colorStr === 'bold') {
    return colors.bold
  }
  if (colorStr === 'inverse') {
    return colors.inverse
  }

  // Handle combined styles like "bold:magenta" or "underline:blue"
  if (colorStr.includes(':')) {
    const parts = colorStr.split(':')
    return (text: string) => {
      let result = text
      for (const part of parts) {
        const fn = parseColorFunction(part)
        result = fn(result)
      }
      return result
    }
  }

  // Handle background colors
  if (colorStr.startsWith('bg')) {
    const bgColor = colorStr.substring(2).toLowerCase()
    const bgFn = (colors as any)[`bg${bgColor.charAt(0).toUpperCase()}${bgColor.slice(1)}`]
    if (bgFn) {
      return bgFn
    }
  }

  // Handle regular colors
  const colorFn = (colors as any)[colorStr]
  if (typeof colorFn === 'function') {
    return colorFn
  }

  // Fallback
  return (text: string) => text
}

/**
 * Build theme from definition
 */
function buildTheme(def: ThemeDefinition): Theme {
  const theme: Theme = {
    name: def.name,
    description: def.description,

    // Colors
    primary: parseColorFunction(def.colors['primary'] || 'magenta'),
    primaryBold: parseColorFunction(def.colors['primaryBold'] || 'bold'),
    secondary: parseColorFunction(def.colors['secondary'] || 'blue'),
    accent: parseColorFunction(def.colors['accent'] || 'cyan'),
    success: parseColorFunction(def.colors['success'] || 'green'),
    warning: parseColorFunction(def.colors['warning'] || 'yellow'),
    error: parseColorFunction(def.colors['error'] || 'red'),
    info: parseColorFunction(def.colors['info'] || 'blue'),
    muted: parseColorFunction(def.colors['muted'] || 'gray'),
    dim: parseColorFunction(def.colors['dim'] || 'dim'),
    bold: parseColorFunction(def.colors['bold'] || 'bold'),

    // Elements
    heading: parseColorFunction(def.elements['heading'] || 'bold'),
    subheading: parseColorFunction(def.elements['subheading'] || 'dim'),
    command: parseColorFunction(def.elements['command'] || 'cyan'),
    code: parseColorFunction(def.elements['code'] || 'yellow'),
    link: parseColorFunction(def.elements['link'] || 'blue'),

    // Icons (plain strings)
    icons: {
      checkmark: def.icons['checkmark'] || '✓',
      cross: def.icons['cross'] || '✗',
      arrow: def.icons['arrow'] || '→',
      bullet: def.icons['bullet'] || '•',
      star: def.icons['star'] || '★',
      warning: def.icons['warning'] || '⚠',
      info: def.icons['info'] || 'ℹ',
      ...def.icons
    },

    // Progress
    spinner: parseColorFunction(def.colors['primary'] || 'magenta'),
    progressBar: parseColorFunction(def.colors['primary'] || 'magenta'),

    // Interactive
    prompt: parseColorFunction(def.colors['primaryBold'] || def.colors['primary'] || 'magenta'),
    input: parseColorFunction(def.colors['accent'] || 'cyan'),
    selection: (text: string) => colors.inverse(text),

    // Table
    tableHeader: parseColorFunction(def.colors['primaryBold'] || def.colors['primary'] || 'magenta'),
    tableRow: (text: string) => text,
    tableBorder: parseColorFunction(def.colors['muted'] || 'gray'),

    // Severity
    severity: {
      critical: parseColorFunction(def.severity['critical'] || 'red'),
      high: parseColorFunction(def.severity['high'] || 'red'),
      medium: parseColorFunction(def.severity['medium'] || 'yellow'),
      low: parseColorFunction(def.severity['low'] || 'blue'),
    },

    // Special
    highlight: (text: string) => colors.inverse(` ${text} `),
    expandHint: (text: string) => `${text} ${colors.dim('(ctrl+o to expand)')}`,
  }

  return theme
}

/**
 * Configuration and themes
 */
const config = loadThemesConfig()
const themes: Record<string, Theme> = {}

// Build all themes from configuration
for (const [name, def] of Object.entries(config.themes)) {
  themes[name] = buildTheme(def)
}

/**
 * Current active theme
 */
let activeTheme: Theme = themes[config.defaultTheme] || themes['purple'] || Object.values(themes)[0]!

/**
 * Get current theme
 */
export function getTheme(): Theme {
  return activeTheme
}

/**
 * Set active theme (internal use only)
 */
export function setTheme(themeName: string): boolean {
  if (!themes[themeName]) {
    return false
  }

  activeTheme = themes[themeName]!
  return true
}

/**
 * Get theme by name
 */
export function getThemeByName(name: string): Theme | undefined {
  return themes[name]
}

/**
 * Get context theme name
 */
export function getContextTheme(context: 'python' | 'firewall' | 'coana' | 'default'): string {
  return config.contextThemes[context] || config.defaultTheme
}

/**
 * Get transition config
 */
export function getTransitionConfig(): typeof config.transitions {
  return config.transitions
}

/**
 * Export current theme as shorthand
 */
export const theme = new Proxy({} as Theme, {
  get(_target, prop: keyof Theme) {
    return activeTheme[prop]
  },
})

/**
 * Helper to format expandable sections with current theme
 */
export function formatExpandable(
  summary: string,
  details: string,
  expanded: boolean = false
): string {
  const t = getTheme()
  if (expanded) {
    return `${t.primary(summary)}\n${details}`
  }
  return t.expandHint(summary)
}

/**
 * Helper for inline progress with current theme
 */
export function inlineProgress(message: string, current: number, total: number): string {
  const t = getTheme()
  const percentage = Math.floor((current / total) * 100)
  const filled = Math.floor((percentage / 100) * 20)
  const empty = 20 - filled
  const bar = t.progressBar('█'.repeat(filled)) + t.muted('░'.repeat(empty))
  return `${message} ${bar} ${t.dim(`${percentage}%`)}`
}