import { defineCommand } from 'citty'

import find from './find'
import info from './info'
import node from './node'
import pages from './pages'
import query from './query'
import selection from './selection'
import tree from './tree'
import variables from './variables'

export const inspectSubCommands = {
  find,
  info,
  node,
  pages,
  query,
  selection,
  tree,
  variables
}

export default defineCommand({
  meta: {
    name: 'inspect',
    description: 'Inspect document structure, nodes, pages, and variables'
  },
  subCommands: inspectSubCommands
})
