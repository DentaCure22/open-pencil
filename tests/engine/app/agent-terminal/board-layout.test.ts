import { describe, expect, it } from 'bun:test'

import {
  AGENT_BOARD_SIDE_GAP,
  AGENT_BOARD_TOP_OFFSET,
  AGENT_CARD_ROW_GAP,
  agentBoardGridOrigin,
  agentBoardPlacement
} from '@/app/agent-terminal/board-layout'

describe('agent-terminal board layout', () => {
  const anchorRect = { x: 72, y: 144, width: 3840, height: 1600 }
  const container = { width: 3970, height: 1704 } as { height: number; width: number }

  it('stacks cards in two columns beside the app inside the workspace frame', () => {
    const wideContainer = { width: 5528, height: 2272 }
    const origin = agentBoardGridOrigin(anchorRect, wideContainer, 4)
    expect(origin).toEqual({
      x: anchorRect.x + anchorRect.width + AGENT_BOARD_SIDE_GAP,
      y: anchorRect.y + AGENT_BOARD_TOP_OFFSET
    })

    const placements = Array.from({ length: 4 }, (_, index) =>
      agentBoardPlacement(index, {
        originX: origin.x,
        originY: origin.y,
        parentId: '0:9000'
      })
    )

    expect(placements).toEqual([
      { parentId: '0:9000', x: 4008, y: 144 },
      { parentId: '0:9000', x: 4696, y: 144 },
      { parentId: '0:9000', x: 4008, y: 992 },
      { parentId: '0:9000', x: 4696, y: 992 }
    ])
  })

  it('falls back below the app when the beside grid does not fit', () => {
    const origin = agentBoardGridOrigin(anchorRect, container, 4)
    expect(origin).toEqual({
      x: 2546,
      y: anchorRect.y + anchorRect.height + AGENT_CARD_ROW_GAP
    })
  })
})
