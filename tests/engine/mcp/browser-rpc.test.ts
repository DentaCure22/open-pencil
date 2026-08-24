import { describe, expect, spyOn, test } from 'bun:test'

import type { WebSocket } from 'ws'

import { createBrowserRpcBridge } from '#mcp/browser-rpc'

type SentMessage = {
  args?: Record<string, unknown>
  command?: string
  id?: string
  type: string
}

function socketFixture() {
  const sent: SentMessage[] = []
  const socketFixture: Pick<WebSocket, 'OPEN' | 'close' | 'readyState' | 'send'> = {
    OPEN: 1,
    close: () => undefined,
    readyState: 1,
    send(value: string) {
      sent.push(JSON.parse(value) as SentMessage)
    }
  }
  const socket = socketFixture as WebSocket
  return { sent, socket }
}

describe('OpenPencil browser RPC runtime routing', () => {
  test('resolves Board navigation across zero, one, preferred, and ambiguous editors', () => {
    const bridge = createBrowserRpcBridge({
      authToken: 'secret',
      onConnectionChange: () => undefined
    })
    const target = { contentDocumentId: 'document:1', workspaceId: 'workspace:1' }

    expect(bridge.resolveNavigationRuntime(target)).toEqual({
      candidateRuntimeIds: [],
      reason: 'no_matching_editor',
      status: 'needs_editor'
    })

    const hidden = socketFixture()
    bridge.handleConnection(hidden.socket)
    bridge.handleMessage(
      JSON.stringify({
        active: false,
        navigation_targets: [{ content_document_id: 'document:1', workspace_id: 'workspace:1' }],
        runtime_instance_id: 'runtime:hidden',
        token: 'secret',
        type: 'register',
        visibility: 'hidden'
      }),
      hidden.socket
    )
    expect(bridge.resolveNavigationRuntime(target)).toMatchObject({
      runtimeInstanceId: 'runtime:hidden',
      status: 'ready'
    })
    const visible = socketFixture()
    bridge.handleConnection(visible.socket)
    bridge.handleMessage(
      JSON.stringify({
        active: true,
        navigation_targets: [{ content_document_id: 'document:1', workspace_id: 'workspace:1' }],
        runtime_instance_id: 'runtime:visible',
        token: 'secret',
        type: 'register',
        visibility: 'visible'
      }),
      visible.socket
    )
    expect(bridge.resolveNavigationRuntime(target)).toEqual({
      candidateRuntimeIds: ['runtime:hidden', 'runtime:visible'],
      runtimeInstanceId: 'runtime:visible',
      status: 'ready'
    })

    bridge.handleMessage(
      JSON.stringify({
        active: false,
        navigation_targets: [{ content_document_id: 'document:1', workspace_id: 'workspace:1' }],
        runtime_instance_id: 'runtime:visible',
        token: 'secret',
        type: 'presence',
        visibility: 'hidden'
      }),
      visible.socket
    )
    expect(bridge.resolveNavigationRuntime(target)).toEqual({
      candidateRuntimeIds: ['runtime:hidden', 'runtime:visible'],
      status: 'ambiguous_editor'
    })
    expect(
      bridge.resolveNavigationRuntime({
        ...target,
        requestedRuntimeInstanceId: 'runtime:hidden'
      })
    ).toMatchObject({ runtimeInstanceId: 'runtime:hidden', status: 'ready' })
    bridge.close()
  })

  test('binds an unpinned Board context to the sole connected runtime', async () => {
    const bridge = createBrowserRpcBridge({
      authToken: 'secret',
      onConnectionChange: () => undefined
    })
    const only = socketFixture()
    bridge.handleConnection(only.socket)
    bridge.handleMessage(
      JSON.stringify({
        active: false,
        runtime_instance_id: 'runtime:only',
        token: 'secret',
        type: 'register'
      }),
      only.socket
    )

    const pending = bridge.sendRpc({
      args: { page_id: 'page:1', workspace_id: 'workspace:1' },
      command: 'board_context'
    })
    const request = only.sent.find((message) => message.type === 'request')
    expect(request).toMatchObject({
      args: {
        page_id: 'page:1',
        runtime_instance_id: 'runtime:only',
        workspace_id: 'workspace:1'
      },
      command: 'board_context'
    })
    if (!request?.id) throw new Error('Board context request was not sent.')
    bridge.handleMessage(
      JSON.stringify({ id: request.id, ok: true, result: { exact: true }, type: 'response' }),
      only.socket
    )

    await expect(pending).resolves.toMatchObject({ result: { exact: true } })
    bridge.close()
  })

  test('times out current-visible Board context once and ignores a late response', async () => {
    let fireTimeout: (() => void) | undefined
    let timeoutDelay: number | undefined
    const timeoutSpy = spyOn(globalThis, 'setTimeout').mockImplementation((handler, delay) => {
      if (typeof handler === 'function') fireTimeout = () => handler()
      timeoutDelay = Number(delay)
      return 1 as unknown as ReturnType<typeof setTimeout>
    })
    const bridge = createBrowserRpcBridge({
      authToken: 'secret',
      onConnectionChange: () => undefined
    })
    try {
      const only = socketFixture()
      bridge.handleConnection(only.socket)
      bridge.handleMessage(
        JSON.stringify({
          active: true,
          runtime_instance_id: 'runtime:visible',
          token: 'secret',
          type: 'register',
          visibility: 'visible',
          write_authority: 'writer'
        }),
        only.socket
      )

      const pending = bridge.sendRpc({
        args: { target: 'current_visible' },
        command: 'board_context'
      })
      const firstRequest = only.sent.find((message) => message.type === 'request')
      expect(firstRequest).toMatchObject({
        args: { runtime_instance_id: 'runtime:visible', target: 'current_visible' },
        command: 'board_context'
      })
      expect(timeoutDelay).toBe(20_000)
      if (!fireTimeout || !firstRequest?.id) throw new Error('Timed Board context was not sent.')
      fireTimeout()
      await expect(pending).rejects.toThrow('RPC timeout (20s)')

      bridge.handleMessage(
        JSON.stringify({ id: firstRequest.id, ok: true, result: { late: true }, type: 'response' }),
        only.socket
      )
      const recovered = bridge.sendRpc({
        args: { target: 'current_visible' },
        command: 'board_context'
      })
      const requests = only.sent.filter((message) => message.type === 'request')
      const secondRequest = requests.at(-1)
      if (!secondRequest?.id) throw new Error('Recovered Board context was not sent.')
      bridge.handleMessage(
        JSON.stringify({
          id: secondRequest.id,
          ok: true,
          result: { exact: true },
          type: 'response'
        }),
        only.socket
      )
      await expect(recovered).resolves.toMatchObject({ result: { exact: true } })
      expect(requests.map((message) => message.command)).toEqual(['board_context', 'board_context'])
    } finally {
      timeoutSpy.mockRestore()
      bridge.close()
    }
  })

  test('fails closed before sending an unpinned Board context to multiple runtimes', async () => {
    const bridge = createBrowserRpcBridge({
      authToken: 'secret',
      onConnectionChange: () => undefined
    })
    const first = socketFixture()
    const second = socketFixture()
    bridge.handleConnection(first.socket)
    bridge.handleConnection(second.socket)
    bridge.handleMessage(
      JSON.stringify({
        active: true,
        runtime_instance_id: 'runtime:z-active',
        token: 'secret',
        type: 'register'
      }),
      first.socket
    )
    bridge.handleMessage(
      JSON.stringify({
        active: false,
        runtime_instance_id: 'runtime:a-hidden',
        token: 'secret',
        type: 'register'
      }),
      second.socket
    )

    await expect(
      bridge.sendRpc({ args: { page_id: 'page:1' }, command: 'board_context' })
    ).rejects.toThrow('runtime:a-hidden, runtime:z-active')
    expect(first.sent.some((message) => message.type === 'request')).toBe(false)
    expect(second.sent.some((message) => message.type === 'request')).toBe(false)
    bridge.close()
  })

  test('routes current-visible context only to the sole visible writer', async () => {
    const bridge = createBrowserRpcBridge({
      authToken: 'secret',
      onConnectionChange: () => undefined
    })
    const hiddenWriter = socketFixture()
    const visibleViewer = socketFixture()
    const visibleWriter = socketFixture()
    const registrations = [
      [hiddenWriter, 'runtime:hidden-writer', 'hidden', 'writer'],
      [visibleViewer, 'runtime:visible-viewer', 'visible', 'viewer'],
      [visibleWriter, 'runtime:visible-writer', 'visible', 'writer']
    ] as const
    for (const [fixture, runtimeInstanceId, visibility, writeAuthority] of registrations) {
      bridge.handleConnection(fixture.socket)
      bridge.handleMessage(
        JSON.stringify({
          active: visibility === 'visible',
          runtime_instance_id: runtimeInstanceId,
          token: 'secret',
          type: 'register',
          visibility,
          write_authority: writeAuthority
        }),
        fixture.socket
      )
    }

    const pending = bridge.sendRpc({
      args: { target: 'current_visible' },
      command: 'board_context'
    })
    const request = visibleWriter.sent.find((message) => message.type === 'request')
    expect(request).toMatchObject({
      args: { runtime_instance_id: 'runtime:visible-writer', target: 'current_visible' },
      command: 'board_context'
    })
    expect(hiddenWriter.sent.some((message) => message.type === 'request')).toBe(false)
    expect(visibleViewer.sent.some((message) => message.type === 'request')).toBe(false)
    if (!request?.id) throw new Error('Current-visible Board context request was not sent.')
    bridge.handleMessage(
      JSON.stringify({ id: request.id, ok: true, result: { exact: true }, type: 'response' }),
      visibleWriter.socket
    )
    await expect(pending).resolves.toMatchObject({ result: { exact: true } })
    bridge.close()
  })

  test('reports one actionable no-visible-writer error for hidden viewers', async () => {
    const bridge = createBrowserRpcBridge({
      authToken: 'secret',
      onConnectionChange: () => undefined
    })
    const first = socketFixture()
    const second = socketFixture()
    for (const [fixture, runtimeInstanceId] of [
      [first, 'runtime:first-hidden-viewer'],
      [second, 'runtime:second-hidden-viewer']
    ] as const) {
      bridge.handleConnection(fixture.socket)
      bridge.handleMessage(
        JSON.stringify({
          active: false,
          runtime_instance_id: runtimeInstanceId,
          token: 'secret',
          type: 'register',
          visibility: 'hidden',
          write_authority: 'viewer'
        }),
        fixture.socket
      )
    }

    await expect(
      bridge.sendRpc({ args: { target: 'current_visible' }, command: 'board_context' })
    ).rejects.toThrow('no_visible_writer: No visible writer-capable OpenPencil Board is connected.')
    expect(first.sent.some((message) => message.type === 'request')).toBe(false)
    expect(second.sent.some((message) => message.type === 'request')).toBe(false)
    bridge.close()
  })

  test('reports ambiguity only across visible writers and preserves exact pinned routing', async () => {
    const bridge = createBrowserRpcBridge({
      authToken: 'secret',
      onConnectionChange: () => undefined
    })
    const first = socketFixture()
    const second = socketFixture()
    for (const [fixture, runtimeInstanceId] of [
      [first, 'runtime:z-visible-writer'],
      [second, 'runtime:a-visible-writer']
    ] as const) {
      bridge.handleConnection(fixture.socket)
      bridge.handleMessage(
        JSON.stringify({
          active: true,
          runtime_instance_id: runtimeInstanceId,
          token: 'secret',
          type: 'register',
          visibility: 'visible',
          write_authority: 'writer'
        }),
        fixture.socket
      )
    }

    await expect(
      bridge.sendRpc({ args: { target: 'current_visible' }, command: 'board_context' })
    ).rejects.toThrow('runtime:a-visible-writer, runtime:z-visible-writer')
    bridge.handleMessage(
      JSON.stringify({
        active: false,
        runtime_instance_id: 'runtime:z-visible-writer',
        token: 'secret',
        type: 'presence',
        visibility: 'hidden',
        write_authority: 'viewer'
      }),
      first.socket
    )
    const pinned = bridge.sendRpc({
      args: {
        runtime_instance_id: 'runtime:z-visible-writer',
        target: 'current_visible'
      },
      command: 'board_context'
    })
    const request = first.sent.find((message) => message.type === 'request')
    if (!request?.id) throw new Error('Pinned current-visible context request was not sent.')
    bridge.handleMessage(
      JSON.stringify({ id: request.id, ok: true, result: { exact: true }, type: 'response' }),
      first.socket
    )
    await expect(pinned).resolves.toMatchObject({ result: { exact: true } })
    bridge.close()
  })

  test('pins document discovery to one runtime and refuses ambiguous unpinned discovery', async () => {
    const bridge = createBrowserRpcBridge({
      authToken: 'secret',
      onConnectionChange: () => undefined
    })
    const first = socketFixture()
    const second = socketFixture()
    bridge.handleConnection(first.socket)
    bridge.handleConnection(second.socket)
    bridge.handleMessage(
      JSON.stringify({
        active: true,
        runtime_instance_id: 'runtime:first',
        token: 'secret',
        type: 'register'
      }),
      first.socket
    )
    bridge.handleMessage(
      JSON.stringify({
        active: false,
        runtime_instance_id: 'runtime:second',
        token: 'secret',
        type: 'register'
      }),
      second.socket
    )

    await expect(bridge.sendRpc({ args: {}, command: 'list_documents' })).rejects.toThrow(
      'list_documents is ambiguous'
    )
    expect(first.sent.some((message) => message.type === 'request')).toBe(false)
    expect(second.sent.some((message) => message.type === 'request')).toBe(false)

    const pending = bridge.sendRpc({
      args: { runtime_instance_id: 'runtime:second' },
      command: 'list_documents'
    })
    const request = second.sent.find((message) => message.type === 'request')
    expect(request).toMatchObject({
      args: { runtime_instance_id: 'runtime:second' },
      command: 'list_documents'
    })
    if (!request?.id) throw new Error('Pinned discovery request was not sent.')
    bridge.handleMessage(
      JSON.stringify({ id: request.id, ok: true, result: { documents: [] }, type: 'response' }),
      second.socket
    )
    await expect(pending).resolves.toMatchObject({ result: { documents: [] } })
    bridge.close()
  })

  test('routes a pinned request only to its exact registered runtime', async () => {
    const bridge = createBrowserRpcBridge({
      authToken: 'secret',
      onConnectionChange: () => undefined
    })
    const first = socketFixture()
    const second = socketFixture()
    bridge.handleConnection(first.socket)
    bridge.handleConnection(second.socket)
    bridge.handleMessage(
      JSON.stringify({
        active: true,
        runtime_instance_id: 'runtime:first',
        token: 'secret',
        type: 'register'
      }),
      first.socket
    )
    bridge.handleMessage(
      JSON.stringify({
        active: false,
        runtime_instance_id: 'runtime:second',
        token: 'secret',
        type: 'register'
      }),
      second.socket
    )

    const pending = bridge.sendRpc({
      args: { runtime_instance_id: 'runtime:second' },
      command: 'board_read'
    })
    const request = second.sent.find((message) => message.type === 'request')
    expect(request?.command).toBe('board_read')
    expect(first.sent.some((message) => message.type === 'request')).toBe(false)
    if (!request?.id) throw new Error('Pinned request was not sent.')
    bridge.handleMessage(
      JSON.stringify({ id: request.id, ok: true, result: { routed: true }, type: 'response' }),
      second.socket
    )

    await expect(pending).resolves.toMatchObject({ result: { routed: true } })
    bridge.close()
  })

  test('fails closed when the requested runtime is unavailable', async () => {
    const bridge = createBrowserRpcBridge({
      authToken: 'secret',
      onConnectionChange: () => undefined
    })
    const first = socketFixture()
    bridge.handleConnection(first.socket)
    bridge.handleMessage(
      JSON.stringify({
        active: true,
        runtime_instance_id: 'runtime:first',
        token: 'secret',
        type: 'register'
      }),
      first.socket
    )

    await expect(
      bridge.sendRpc({
        args: { runtime_instance_id: 'runtime:missing' },
        command: 'board_present'
      })
    ).rejects.toThrow('runtime:missing')
    expect(first.sent.some((message) => message.type === 'request')).toBe(false)
    bridge.close()
  })

  test('restores singleton Board context routing after the other runtime disconnects', async () => {
    const bridge = createBrowserRpcBridge({
      authToken: 'secret',
      onConnectionChange: () => undefined
    })
    const first = socketFixture()
    const second = socketFixture()
    bridge.handleConnection(first.socket)
    bridge.handleConnection(second.socket)
    bridge.handleMessage(
      JSON.stringify({
        active: true,
        runtime_instance_id: 'runtime:first',
        token: 'secret',
        type: 'register'
      }),
      first.socket
    )
    bridge.handleMessage(
      JSON.stringify({
        active: false,
        runtime_instance_id: 'runtime:second',
        token: 'secret',
        type: 'register'
      }),
      second.socket
    )
    bridge.handleClose(second.socket)

    const pending = bridge.sendRpc({ args: { page_id: 'page:1' }, command: 'board_context' })
    const request = first.sent.find((message) => message.type === 'request')
    expect(request?.args?.runtime_instance_id).toBe('runtime:first')
    if (!request?.id) throw new Error('Singleton Board context request was not sent.')
    bridge.handleMessage(
      JSON.stringify({ id: request.id, ok: true, result: { exact: true }, type: 'response' }),
      first.socket
    )
    await expect(pending).resolves.toMatchObject({ result: { exact: true } })
    bridge.close()
  })

  test('does not let an old same-ID socket remove its replacement runtime', async () => {
    const bridge = createBrowserRpcBridge({
      authToken: 'secret',
      onConnectionChange: () => undefined
    })
    const previous = socketFixture()
    const replacement = socketFixture()
    bridge.handleConnection(previous.socket)
    bridge.handleConnection(replacement.socket)
    for (const socket of [previous.socket, replacement.socket]) {
      bridge.handleMessage(
        JSON.stringify({
          active: true,
          runtime_instance_id: 'runtime:reconnected',
          token: 'secret',
          type: 'register'
        }),
        socket
      )
    }
    bridge.handleClose(previous.socket)

    const pending = bridge.sendRpc({
      args: { runtime_instance_id: 'runtime:reconnected' },
      command: 'board_context'
    })
    const request = replacement.sent.find((message) => message.type === 'request')
    expect(request?.command).toBe('board_context')
    if (!request?.id) throw new Error('Replacement runtime request was not sent.')
    bridge.handleMessage(
      JSON.stringify({ id: request.id, ok: true, result: { exact: true }, type: 'response' }),
      replacement.socket
    )
    await expect(pending).resolves.toMatchObject({ result: { exact: true } })
    bridge.close()
  })
})
