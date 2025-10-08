/** @fileoverview Interactive tour command for Socket CLI */

import { buildCommand } from '../../utils/command-builder.mts'
import { runInteractiveTour, showTourSummary } from '../../utils/interactive-tour.mts'
import isInteractive from '@socketregistry/is-interactive/index.cjs'

export const cmdTour = buildCommand({
  name: 'tour',
  description: 'Interactive guided tour of Socket CLI features',
  handler: async () => {
    if (isInteractive()) {
      await runInteractiveTour()
    } else {
      showTourSummary()
    }
  },
  examples: [
    { command: '', description: 'Start the interactive tour' },
  ],
})