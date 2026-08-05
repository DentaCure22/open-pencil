import { defineCommand } from 'citty'

import clusters from './clusters'
import colors from './colors'
import overlaps from './overlaps'
import spacing from './spacing'
import typography from './typography'

export default defineCommand({
  meta: { name: 'analyze', description: 'Analyze design tokens and patterns' },
  subCommands: {
    colors,
    typography,
    spacing,
    clusters,
    overlaps
  }
})
