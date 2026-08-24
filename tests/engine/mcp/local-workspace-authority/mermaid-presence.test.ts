import { describe, expect, test } from 'bun:test'

import { documentMayNeedMermaidMaterialization } from '#mcp/local-workspace-authority/mermaid-presence'

describe('mermaid presence', () => {
  test('trusts a mermaidPresent flag without walking nodes', () => {
    expect(
      documentMayNeedMermaidMaterialization({
        mermaidPresent: false,
        nodes: [['0:2', { id: '0:2', mermaidSource: 'graph TD; A-->B', type: 'FRAME' }]]
      })
    ).toBe(false)
    expect(
      documentMayNeedMermaidMaterialization({
        mermaidPresent: true,
        nodes: [['0:1', { id: '0:1', name: 'Card', type: 'FRAME' }]]
      })
    ).toBe(true)
    expect(
      documentMayNeedMermaidMaterialization(
        {
          mermaidFingerprint: 'role:0:3:flowchart',
          mermaidPresent: true,
          nodes: [['0:1', { id: '0:1', name: 'Card', type: 'FRAME' }]]
        },
        {
          mermaidFingerprint: 'role:0:3:flowchart',
          mermaidPresent: true
        }
      )
    ).toBe(false)
    expect(
      documentMayNeedMermaidMaterialization(
        {
          mermaidFingerprint: 'role:0:3:flowchart LR',
          mermaidPresent: true
        },
        {
          mermaidFingerprint: 'role:0:3:flowchart',
          mermaidPresent: true
        }
      )
    ).toBe(true)
  })

  test('skips documents with no mermaid owners', () => {
    expect(
      documentMayNeedMermaidMaterialization({
        nodes: [['0:1', { id: '0:1', name: 'Card', type: 'FRAME' }]],
        rootId: '0:1'
      })
    ).toBe(false)
  })

  test('detects declarative mermaid source and diagram roles', () => {
    expect(
      documentMayNeedMermaidMaterialization({
        nodes: [['0:2', { id: '0:2', mermaidSource: 'graph TD; A-->B', type: 'FRAME' }]],
        rootId: '0:2'
      })
    ).toBe(true)
    expect(
      documentMayNeedMermaidMaterialization({
        nodes: [
          [
            '0:3',
            {
              id: '0:3',
              pluginData: [{ key: 'mermaid/role', pluginId: 'open-pencil', value: 'diagram' }],
              type: 'FRAME'
            }
          ]
        ],
        rootId: '0:3'
      })
    ).toBe(true)
  })
})
