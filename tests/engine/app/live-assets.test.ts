import { describe, expect, test } from 'bun:test'

import { parseOpenPencilClipboard } from '@open-pencil/core/clipboard'

import type {
  SmylrLiveContainerDocument,
  SmylrLiveContainerNode
} from '@/app/smylr-live-container/types'
import {
  buildSmylrLiveComponentClipboardHtml,
  collectSmylrLiveComponentAssets,
  findSmylrComputedComponentAsset
} from '@/app/smylr-live-inspector/assets'

function liveNode(
  id: string,
  componentName: string | null,
  width: number,
  children: SmylrLiveContainerNode[] = [],
  filePath = 'src/components/example.tsx'
): SmylrLiveContainerNode {
  return {
    children,
    id,
    label: componentName ?? id,
    rect: { height: 40, width, x: 0, y: 0 },
    source: componentName ? { componentName, filePath } : undefined,
    tagName: 'div'
  }
}

function liveDocument(tree: SmylrLiveContainerNode): SmylrLiveContainerDocument {
  return {
    capturedAt: new Date(0).toISOString(),
    route: '/dental-chart',
    selectedId: tree.id,
    title: 'Dental Chart',
    tree
  }
}

describe('Smylr live component assets', () => {
  test('deduplicates component owners and keeps the largest rendered representative', () => {
    const smallMenuItem = liveNode('menu-small', 'SidebarMenuItem', 80)
    const largeMenuItem = liveNode('menu-large', 'SidebarMenuItem', 240)
    const alert = liveNode('alert', 'ClinicalAlert', 320, [], 'src/components/clinical-alert.tsx')
    const root = liveNode('root', null, 800, [smallMenuItem, largeMenuItem, alert])

    const assets = collectSmylrLiveComponentAssets(liveDocument(root))

    expect(assets.map((asset) => asset.name)).toEqual(['ClinicalAlert', 'SidebarMenuItem'])
    expect(assets.find((asset) => asset.name === 'SidebarMenuItem')?.node.id).toBe('menu-large')
    expect(assets.find((asset) => asset.name === 'ClinicalAlert')?.sourcePath).toBe(
      'src/components/clinical-alert.tsx'
    )
  })

  test('keeps same-named components from different source files distinct', () => {
    const root = liveNode('root', null, 800, [
      liveNode('first', 'Card', 100, [], 'src/components/ui/card.tsx'),
      liveNode('second', 'Card', 100, [], 'src/features/patient/card.tsx')
    ])

    expect(collectSmylrLiveComponentAssets(liveDocument(root))).toHaveLength(2)
  })

  test('converts a live asset directly into native editable clipboard nodes', () => {
    const child = liveNode('label', null, 80)
    child.tagName = 'span'
    child.text = 'Patient details'
    const card = liveNode('card', 'Card', 240, [child])
    const document = liveDocument(liveNode('root', null, 800, [card]))
    const asset = collectSmylrLiveComponentAssets(document)[0]

    expect(asset).toBeDefined()
    if (!asset) return
    const html = buildSmylrLiveComponentClipboardHtml(document, asset)
    const parsed = html ? parseOpenPencilClipboard(html) : null

    expect(parsed?.nodes).toHaveLength(1)
    expect(parsed?.nodes[0]?.name).toBe('Card')
    expect(parsed?.nodes[0]?.children?.[0]?.name).toBe('label')
  })

  test('keeps a computed primitive root as a styled native frame', () => {
    const button = liveNode('button-root', null, 112)
    button.tagName = 'button'
    button.text = 'Save changes'
    button.attrs = { 'data-slot': 'button' }
    button.computedStyle = {
      'background-color': 'rgb(37, 99, 235)',
      'border-radius': '8px',
      color: 'rgb(255, 255, 255)',
      display: 'inline-flex',
      'font-family': 'Quicksand, sans-serif',
      'font-size': '14px',
      'font-weight': '500'
    }
    const document = liveDocument(liveNode('root', null, 800, [button]))
    const asset = findSmylrComputedComponentAsset(
      document,
      'Button',
      'src/components/ui/button.tsx'
    )

    expect(asset?.node.id).toBe('button-root')
    if (!asset) return
    const html = buildSmylrLiveComponentClipboardHtml(document, asset)
    const parsed = html ? parseOpenPencilClipboard(html) : null
    const text = parsed?.nodes[0]?.children?.find((child) => child.type === 'TEXT')

    expect(parsed?.nodes[0]?.type).toBe('FRAME')
    expect(parsed?.nodes[0]?.fills).toHaveLength(1)
    expect(text?.text).toBe('Save changes')
    expect(text?.fontFamily).toBe('Inter')
    expect(text?.fills[0]?.color).toMatchObject({ b: 1, g: 1, r: 1 })
  })

  test('keeps rendered SVG paths as editable native vectors', () => {
    const path = liveNode('check-path', null, 12)
    path.tagName = 'path'
    path.label = 'check path'
    path.attrs = { 'data-smylr-vector-path': 'M20 6 9 17l-5-5' }
    path.computedStyle = {
      fill: 'none',
      stroke: 'rgb(255, 255, 255)',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'stroke-width': '3px'
    }
    path.rect = { height: 6, width: 9, x: 2, y: 4 }
    const svg = liveNode('check-svg', null, 14, [path])
    svg.tagName = 'svg'
    svg.rect = { height: 14, width: 14, x: 2, y: 0 }
    const indicator = liveNode('indicator', null, 14, [svg])
    indicator.attrs = { 'data-slot': 'checkbox-indicator' }
    indicator.rect = { height: 14, width: 18, x: 1, y: 3 }
    const checkbox = liveNode('checkbox-root', null, 20, [indicator])
    checkbox.tagName = 'button'
    checkbox.attrs = { 'data-slot': 'checkbox' }
    checkbox.computedStyle = {
      'background-color': 'rgb(37, 99, 235)',
      'border-radius': '6px'
    }
    const document = liveDocument(liveNode('root', null, 800, [checkbox]))
    const asset = findSmylrComputedComponentAsset(
      document,
      'Checkbox',
      'src/components/ui/checkbox.tsx'
    )

    expect(asset).toBeDefined()
    if (!asset) return
    const html = buildSmylrLiveComponentClipboardHtml(document, asset)
    const parsed = html ? parseOpenPencilClipboard(html) : null
    const indicatorNode = parsed?.nodes[0]?.children?.[0]
    const svgNode = indicatorNode?.children?.[0]
    const vector = svgNode?.children?.find((child) => child.type === 'VECTOR')

    expect(vector?.type).toBe('VECTOR')
    expect(vector?.strokes[0]?.weight).toBe(3)
    expect(vector?.strokes[0]?.color).toMatchObject({ b: 1, g: 1, r: 1 })
    expect(vector?.vectorNetwork?.segments.length).toBeGreaterThan(0)
    expect(indicatorNode).toMatchObject({ x: 1, y: 3 })
    expect(svgNode).toMatchObject({ x: 2, y: 0 })
    expect(vector).toMatchObject({ x: 2, y: 4 })
  })
})
