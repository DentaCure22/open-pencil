import { describe, expect, it } from 'bun:test'

import {
  BOARD_NATIVE_CREATE_TYPES,
  isBoardNativeCreateType,
  isLegacyDesignNodeType,
  LEGACY_DESIGN_NODE_TYPES
} from '@open-pencil/core/editor'

describe('Board native object policy', () => {
  it('keeps design-system nodes as legacy interchange data, not authorable Board objects', () => {
    expect(LEGACY_DESIGN_NODE_TYPES).toEqual(['COMPONENT', 'COMPONENT_SET', 'INSTANCE'])

    for (const type of LEGACY_DESIGN_NODE_TYPES) {
      expect(isLegacyDesignNodeType(type)).toBe(true)
      expect(isBoardNativeCreateType(type)).toBe(false)
    }
  })

  it('keeps the ordinary native drawing and layout objects authorable', () => {
    expect(BOARD_NATIVE_CREATE_TYPES).toContain('FRAME')
    expect(BOARD_NATIVE_CREATE_TYPES).toContain('TEXT')
    expect(BOARD_NATIVE_CREATE_TYPES).toContain('CONNECTOR')
    expect(isBoardNativeCreateType('CANVAS')).toBe(false)
  })
})
