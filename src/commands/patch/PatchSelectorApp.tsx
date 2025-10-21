// @ts-nocheck
/** @fileoverview Patch selector Ink React component with multi-select checkboxes. */

import { Box, Text, useApp, useInput } from 'ink'
import type React from 'react'
import { createElement, useEffect, useState } from 'react'

import type { DiscoveredPatch } from './handle-patch-discover.mts'

export type PatchSelectorAppProps = {
  patches: DiscoveredPatch[]
  onSelect: (selectedPatches: DiscoveredPatch[]) => void
}

/**
 * Shimmering text component with purple gradient effect.
 */
function ShimmerText({ children }: { children: string }): React.ReactElement {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame(f => (f + 1) % 20)
    }, 100)
    return () => clearInterval(interval)
  }, [])

  const colors = ['#8B5CF6', '#A78BFA', '#C4B5FD', '#DDD6FE']
  const colorIndex = Math.floor(frame / 5) % colors.length

  return createElement(
    Text,
    { color: colors[colorIndex], bold: true },
    children,
  )
}

/**
 * Patch selector app with multi-select checkboxes.
 */
export function PatchSelectorApp({
  patches,
  onSelect,
}: PatchSelectorAppProps): React.ReactElement {
  const { exit } = useApp()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [selectedPatches, setSelectedPatches] = useState<Set<number>>(new Set())

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      exit()
      onSelect([])
    } else if (key.ctrl && input === 'c') {
      exit()
      process.exit(0)
    } else if (key.upArrow || input === 'k') {
      setSelectedIndex(prev => Math.max(0, prev - 1))
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex(prev => Math.min(patches.length - 1, prev + 1))
    } else if (input === ' ') {
      // Toggle selection.
      setSelectedPatches(prev => {
        const next = new Set(prev)
        if (next.has(selectedIndex)) {
          next.delete(selectedIndex)
        } else {
          next.add(selectedIndex)
        }
        return next
      })
    } else if (input === 'a') {
      // Select all.
      setSelectedPatches(new Set(patches.map((_, i) => i)))
    } else if (input === 'n') {
      // Select none.
      setSelectedPatches(new Set())
    } else if (key.return) {
      // Apply selected patches.
      const selected = patches.filter((_, i) => selectedPatches.has(i))
      exit()
      onSelect(selected)
    }
  })

  return createElement(
    Box,
    { flexDirection: 'column', paddingX: 2, paddingY: 1 },
    // Header
    createElement(
      Box,
      {
        borderStyle: 'double',
        borderColor: 'magenta',
        paddingX: 2,
        paddingY: 1,
        marginBottom: 1,
      },
      createElement(
        Box,
        { flexDirection: 'column', width: '100%' },
        createElement(
          Box,
          { justifyContent: 'center', marginBottom: 1 },
          createElement(ShimmerText, {}, '🛡️  Socket Security Patches'),
        ),
        createElement(
          Box,
          { justifyContent: 'center' },
          createElement(
            Text,
            { dimColor: true },
            'Select patches to apply to your project',
          ),
        ),
      ),
    ),
    // Patch List
    createElement(
      Box,
      {
        borderStyle: 'single',
        borderColor: 'cyan',
        flexDirection: 'column',
        paddingX: 1,
        marginBottom: 1,
      },
      patches.map((patch, index) => {
        const isSelected = selectedPatches.has(index)
        const isCursor = index === selectedIndex
        const checkbox = isSelected ? '[✓]' : '[ ]'
        const cursor = isCursor ? '▶ ' : '  '

        const freeCveCount = patch.freeCves.length
        const paidCveCount = patch.paidCves.length
        const totalCveCount = freeCveCount + paidCveCount

        let vulnText = ''
        if (totalCveCount > 0) {
          if (paidCveCount > 0) {
            vulnText = ` (${freeCveCount} free + ${paidCveCount} enterprise CVEs)`
          } else {
            vulnText = ` (${freeCveCount} free CVE${freeCveCount !== 1 ? 's' : ''})`
          }
        }

        return createElement(
          Box,
          { key: index, flexDirection: 'column' },
          createElement(
            Text,
            {
              color: isCursor ? 'magenta' : undefined,
              bold: isCursor,
              backgroundColor: isCursor ? 'gray' : undefined,
            },
            cursor,
            createElement(
              Text,
              { color: isSelected ? 'green' : 'white' },
              checkbox,
            ),
            ' ',
            createElement(
              Text,
              { color: 'cyan' },
              patch.purl || 'Unknown package',
            ),
            createElement(Text, { color: 'yellow' }, vulnText),
          ),
          // Show features if available.
          patch.freeFeatures.length > 0 || patch.paidFeatures.length > 0
            ? createElement(
                Box,
                { marginLeft: 6, flexDirection: 'column' },
                patch.freeFeatures.map((feature, i) =>
                  createElement(
                    Text,
                    { key: `free-${i}`, color: 'green', dimColor: !isCursor },
                    `  ✓ ${feature}`,
                  ),
                ),
                patch.paidFeatures.map((feature, i) =>
                  createElement(
                    Text,
                    { key: `paid-${i}`, color: 'magenta', dimColor: !isCursor },
                    `  ⭐ ${feature}`,
                  ),
                ),
              )
            : null,
        )
      }),
    ),
    // Summary
    createElement(
      Box,
      {
        borderStyle: 'single',
        borderColor: 'yellow',
        paddingX: 2,
        marginBottom: 1,
      },
      createElement(
        Text,
        { color: 'yellow' },
        `Selected: ${selectedPatches.size} / ${patches.length} patches`,
      ),
    ),
    // Controls
    createElement(
      Box,
      {
        borderStyle: 'single',
        borderColor: 'magenta',
        paddingX: 2,
        backgroundColor: 'black',
      },
      createElement(
        Box,
        { flexDirection: 'column', width: '100%' },
        createElement(
          Text,
          { color: 'magenta' },
          createElement(Text, { bold: true }, 'Space:'),
          ' Toggle  ',
          createElement(Text, { bold: true }, 'a:'),
          ' All  ',
          createElement(Text, { bold: true }, 'n:'),
          ' None',
        ),
        createElement(
          Text,
          { color: 'magenta' },
          createElement(Text, { bold: true }, '↑/↓:'),
          ' Navigate  ',
          createElement(Text, { bold: true }, 'Enter:'),
          ' Apply  ',
          createElement(Text, { bold: true }, 'q/ESC:'),
          ' Cancel',
        ),
      ),
    ),
  )
}
