import {
  Align,
  Direction,
  Display,
  Edge,
  FlexDirection,
  Gutter,
  MeasureMode,
  Overflow,
  Wrap,
  type Node as YogaNode
} from 'yoga-layout'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { createGridChildNode } from '#core/layout/grid'
import { estimateTextSize, getTextMeasurer } from '#core/layout/text-measurement'
import {
  applyMinMaxConstraints,
  configureAbsoluteChild,
  createYogaNode,
  mapAlign,
  mapAlignSelf,
  mapGridTrack,
  mapJustify
} from '#core/layout/yoga-helpers'
import { resolveNodeLayoutDirection } from '#core/text/direction'

export function buildFlexTree(
  graph: SceneGraph,
  frame: SceneNode,
  inheritedDirection: 'LTR' | 'RTL'
): YogaNode {
  const root = createYogaNode()
  const direction = resolveNodeLayoutDirection(frame, inheritedDirection)

  if (frame.primaryAxisSizing === 'FIXED') {
    if (frame.layoutMode === 'HORIZONTAL') root.setWidth(frame.width)
    else root.setHeight(frame.height)
  }
  if (frame.counterAxisSizing === 'FIXED') {
    if (frame.layoutMode === 'HORIZONTAL') root.setHeight(frame.height)
    else root.setWidth(frame.width)
  }

  configureFlexContainer(root, frame, direction)

  for (const child of graph.getChildren(frame.id)) {
    const yogaChild = createYogaNode()

    if (child.layoutPositioning === 'ABSOLUTE') {
      configureAbsoluteChild(yogaChild, child)
    } else if (!child.visible) {
      yogaChild.setDisplay(Display.None)
    } else if (child.layoutMode === 'GRID') {
      configureChildAsGrid(yogaChild, child, frame, graph, direction)
    } else if (child.layoutMode !== 'NONE') {
      configureChildAsAutoLayout(yogaChild, child, frame, graph, direction)
    } else {
      configureChildAsLeaf(yogaChild, child, frame)
    }

    root.insertChild(yogaChild, root.getChildCount())
  }

  return root
}

function configureFlexContainer(
  yogaNode: YogaNode,
  node: SceneNode,
  direction: Exclude<SceneNode['layoutDirection'], 'AUTO'>
): void {
  yogaNode.setDirection(direction === 'RTL' ? Direction.RTL : Direction.LTR)
  yogaNode.setFlexDirection(
    node.layoutMode === 'HORIZONTAL' ? FlexDirection.Row : FlexDirection.Column
  )
  yogaNode.setFlexWrap(node.layoutWrap === 'WRAP' ? Wrap.Wrap : Wrap.NoWrap)
  yogaNode.setJustifyContent(mapJustify(node.primaryAxisAlign))
  yogaNode.setAlignItems(mapAlign(node.counterAxisAlign))
  if (node.clipsContent) yogaNode.setOverflow(Overflow.Hidden)

  if (node.layoutWrap === 'WRAP' && node.counterAxisAlignContent === 'SPACE_BETWEEN') {
    yogaNode.setAlignContent(Align.SpaceBetween)
  }

  yogaNode.setPadding(Edge.Top, node.paddingTop)
  yogaNode.setPadding(Edge.Right, node.paddingRight)
  yogaNode.setPadding(Edge.Bottom, node.paddingBottom)
  yogaNode.setPadding(Edge.Left, node.paddingLeft)

  yogaNode.setGap(
    Gutter.Column,
    node.layoutMode === 'HORIZONTAL' ? node.itemSpacing : node.counterAxisSpacing
  )
  yogaNode.setGap(
    Gutter.Row,
    node.layoutMode === 'HORIZONTAL' ? node.counterAxisSpacing : node.itemSpacing
  )

  applyMinMaxConstraints(yogaNode, node)
}

function configureChildAsGrid(
  yogaChild: YogaNode,
  child: SceneNode,
  parent: SceneNode,
  graph: SceneGraph,
  inheritedDirection: 'LTR' | 'RTL'
): void {
  const direction = resolveNodeLayoutDirection(child, inheritedDirection)
  yogaChild.setDisplay(Display.Grid)
  yogaChild.setDirection(direction === 'RTL' ? Direction.RTL : Direction.LTR)

  if (child.gridTemplateColumns.length > 0) {
    yogaChild.setGridTemplateColumns(child.gridTemplateColumns.map(mapGridTrack))
  }
  if (child.gridTemplateRows.length > 0) {
    yogaChild.setGridTemplateRows(child.gridTemplateRows.map(mapGridTrack))
  }

  yogaChild.setGap(Gutter.Column, child.gridColumnGap)
  yogaChild.setGap(Gutter.Row, child.gridRowGap)

  yogaChild.setPadding(Edge.Top, child.paddingTop)
  yogaChild.setPadding(Edge.Right, child.paddingRight)
  yogaChild.setPadding(Edge.Bottom, child.paddingBottom)
  yogaChild.setPadding(Edge.Left, child.paddingLeft)

  const isParentRow = parent.layoutMode === 'HORIZONTAL'
  const selfOverride = child.layoutAlignSelf !== 'AUTO'
  const stretchCross = selfOverride
    ? child.layoutAlignSelf === 'STRETCH'
    : parent.counterAxisAlign === 'STRETCH'

  if (child.layoutGrow > 0) {
    yogaChild.setFlexGrow(child.layoutGrow)
    yogaChild.setFlexShrink(1)
    yogaChild.setFlexBasis(0)
    if (!stretchCross) {
      if (isParentRow) yogaChild.setHeight(child.height)
      else yogaChild.setWidth(child.width)
    }
  } else if (isParentRow) {
    yogaChild.setWidth(child.width)
    if (!stretchCross) yogaChild.setHeight(child.height)
  } else {
    if (child.gridTemplateRows.length > 0) yogaChild.setHeight(child.height)
    if (!stretchCross) yogaChild.setWidth(child.width)
  }

  const selfAlign = mapAlignSelf(child.layoutAlignSelf)
  if (selfAlign != null) yogaChild.setAlignSelf(selfAlign)

  applyMinMaxConstraints(yogaChild, child)

  for (const grandchild of graph.getChildren(child.id)) {
    if (grandchild.layoutPositioning === 'ABSOLUTE') {
      const yogaGrandchild = createYogaNode()
      configureAbsoluteChild(yogaGrandchild, grandchild)
      yogaChild.insertChild(yogaGrandchild, yogaChild.getChildCount())
    } else {
      yogaChild.insertChild(createGridChildNode(grandchild), yogaChild.getChildCount())
    }
  }
}

function configureChildAsAutoLayout(
  yogaChild: YogaNode,
  child: SceneNode,
  parent: SceneNode,
  graph: SceneGraph,
  inheritedDirection: 'LTR' | 'RTL'
): void {
  const direction = resolveNodeLayoutDirection(child, inheritedDirection)
  const isParentRow = parent.layoutMode === 'HORIZONTAL'
  const isChildRow = child.layoutMode === 'HORIZONTAL'

  const widthSizing = isChildRow ? child.primaryAxisSizing : child.counterAxisSizing
  const heightSizing = isChildRow ? child.counterAxisSizing : child.primaryAxisSizing

  if (isParentRow) {
    setMainAxisSizing(yogaChild, 'width', widthSizing, child.width, child.layoutGrow)
    setCrossAxisSizing(yogaChild, 'height', heightSizing, child.height)
  } else {
    setCrossAxisSizing(yogaChild, 'width', widthSizing, child.width)
    setMainAxisSizing(yogaChild, 'height', heightSizing, child.height, child.layoutGrow)
  }

  const selfAlign = mapAlignSelf(child.layoutAlignSelf)
  if (selfAlign != null) yogaChild.setAlignSelf(selfAlign)

  configureFlexContainer(yogaChild, child, direction)

  for (const grandchild of graph.getChildren(child.id)) {
    const yogaGrandchild = createYogaNode()
    if (grandchild.layoutPositioning === 'ABSOLUTE') {
      configureAbsoluteChild(yogaGrandchild, grandchild)
    } else if (!grandchild.visible) {
      yogaGrandchild.setDisplay(Display.None)
    } else if (grandchild.layoutMode === 'GRID') {
      configureChildAsGrid(yogaGrandchild, grandchild, child, graph, direction)
    } else if (grandchild.layoutMode !== 'NONE') {
      configureChildAsAutoLayout(yogaGrandchild, grandchild, child, graph, direction)
    } else {
      configureChildAsLeaf(yogaGrandchild, grandchild, child)
    }
    yogaChild.insertChild(yogaGrandchild, yogaChild.getChildCount())
  }
}

function configureChildAsLeaf(yogaChild: YogaNode, child: SceneNode, parent: SceneNode): void {
  const isRow = parent.layoutMode === 'HORIZONTAL'
  const selfOverride = child.layoutAlignSelf !== 'AUTO'
  const stretchCross = selfOverride
    ? child.layoutAlignSelf === 'STRETCH'
    : parent.counterAxisAlign === 'STRETCH'

  const isText = child.type === 'TEXT'
  const textMeasurer = getTextMeasurer()
  const needsMeasureFunc = isText && textMeasurer && child.textAutoResize !== 'NONE'

  if (needsMeasureFunc) {
    configureTextLeaf(yogaChild, child, parent)
  } else if (isText && !textMeasurer && child.textAutoResize !== 'NONE') {
    configureUnmeasuredTextLeaf(yogaChild, child, parent, isRow)
  } else {
    configureNonTextLeaf(yogaChild, child, isRow, stretchCross)
  }

  const selfAlign = mapAlignSelf(child.layoutAlignSelf)
  if (selfAlign != null) yogaChild.setAlignSelf(selfAlign)

  applyMinMaxConstraints(yogaChild, child)
}

function configureUnmeasuredTextLeaf(
  yogaChild: YogaNode,
  child: SceneNode,
  parent: SceneNode,
  isRow: boolean
): void {
  const hasStoredSize =
    child.width > 0 && child.height > 0 && !(child.width === 100 && child.height === 100)

  if (child.textAutoResize === 'WIDTH_AND_HEIGHT') {
    if (hasStoredSize) {
      yogaChild.setWidth(child.width)
      yogaChild.setHeight(child.height)
    } else {
      const estimated = estimateTextSize(child)
      yogaChild.setWidth(estimated.width)
      yogaChild.setHeight(estimated.height)
    }
    return
  }

  if (child.textAutoResize !== 'HEIGHT') return
  const stretches =
    child.layoutAlignSelf === 'STRETCH' ||
    (child.layoutAlignSelf === 'AUTO' && parent.counterAxisAlign === 'STRETCH')
  if (!(!isRow && stretches)) yogaChild.setWidth(child.width)
  if (hasStoredSize) {
    yogaChild.setHeight(child.height)
  } else {
    yogaChild.setHeight(estimateTextSize(child, child.width).height)
  }
}

function configureTextLeaf(yogaChild: YogaNode, child: SceneNode, parent: SceneNode): void {
  const autoResize = child.textAutoResize
  const isRow = parent.layoutMode === 'HORIZONTAL'

  if (child.layoutGrow > 0) yogaChild.setFlexGrow(child.layoutGrow)

  const cache = new Map<number, { width: number; height: number }>()
  const unconstrainedKey = -1

  if (autoResize === 'WIDTH_AND_HEIGHT') {
    const importedSize = child.figmaDerivedLayout
    if (importedSize?.width !== undefined && importedSize.height !== undefined) {
      yogaChild.setWidth(child.width)
      yogaChild.setHeight(child.height)
      return
    }

    yogaChild.setMeasureFunc((width, widthMode) => {
      const maxWidth = widthMode === MeasureMode.Undefined ? undefined : width
      const cacheKey = maxWidth === undefined ? unconstrainedKey : Math.round(maxWidth)
      const cached = cache.get(cacheKey)
      if (cached) return cached

      const result = getTextMeasurer()?.(child, maxWidth) ?? estimateTextSize(child, maxWidth)
      cache.set(cacheKey, result)
      return result
    })
  } else if (autoResize === 'HEIGHT') {
    const stretchesCross =
      child.layoutAlignSelf === 'STRETCH' ||
      (child.layoutAlignSelf === 'AUTO' && parent.counterAxisAlign === 'STRETCH')
    const fillsWidth = !isRow && stretchesCross
    const fixedWidth = child.width
    if (child.layoutGrow <= 0 && !fillsWidth) yogaChild.setWidth(fixedWidth)
    yogaChild.setMeasureFunc((width, widthMode) => {
      let constraintWidth = fixedWidth
      if (fillsWidth) {
        if (widthMode !== MeasureMode.Undefined) constraintWidth = width
      } else if (widthMode !== MeasureMode.Undefined) {
        constraintWidth = Math.min(width, fixedWidth || width)
      }
      const cacheKey = Math.round(constraintWidth)
      const cached = cache.get(cacheKey)
      if (cached) return cached

      const measured = getTextMeasurer()?.(child, constraintWidth)
      const result = {
        width: constraintWidth,
        height: measured?.height ?? estimateTextSize(child, constraintWidth).height
      }
      cache.set(cacheKey, result)
      return result
    })
  }
}

function configureNonTextLeaf(
  yogaChild: YogaNode,
  child: SceneNode,
  isRow: boolean,
  stretchCross: boolean
): void {
  if (child.layoutGrow > 0) {
    yogaChild.setFlexGrow(child.layoutGrow)
    if (!stretchCross) {
      if (isRow) yogaChild.setHeight(child.height)
      else yogaChild.setWidth(child.width)
    }
  } else if (isRow) {
    yogaChild.setWidth(child.width)
    if (!stretchCross) yogaChild.setHeight(child.height)
  } else {
    yogaChild.setHeight(child.height)
    if (!stretchCross) yogaChild.setWidth(child.width)
  }
}

function setMainAxisSizing(
  yogaNode: YogaNode,
  axis: 'width' | 'height',
  sizing: string,
  fixedValue: number,
  grow: number
): void {
  if (grow > 0) {
    yogaNode.setFlexGrow(grow)
    yogaNode.setFlexShrink(1)
    yogaNode.setFlexBasis(0)
    return
  }

  switch (sizing) {
    case 'FIXED':
      if (axis === 'width') yogaNode.setWidth(fixedValue)
      else yogaNode.setHeight(fixedValue)
      break
    case 'HUG':
      break
    case 'FILL':
      yogaNode.setFlexGrow(1)
      yogaNode.setFlexShrink(1)
      yogaNode.setFlexBasis(0)
      break
  }
}

function setCrossAxisSizing(
  yogaNode: YogaNode,
  axis: 'width' | 'height',
  sizing: string,
  fixedValue: number
): void {
  switch (sizing) {
    case 'FIXED':
      if (axis === 'width') yogaNode.setWidth(fixedValue)
      else yogaNode.setHeight(fixedValue)
      break
    case 'HUG':
      break
    case 'FILL':
      yogaNode.setAlignSelf(Align.Stretch)
      break
  }
}
