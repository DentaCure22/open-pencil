import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&html-source')

test('opens a legacy Orbit frame in the authoritative Code Object inspector', async () => {
  const frameId = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const frame = store.graph.createNode('FRAME', store.state.currentPageId, {
      clipsContent: true,
      fills: [],
      height: 600,
      name: 'Orbit lab',
      pluginData: [
        {
          key: 'kind',
          pluginId: 'openpencil-live-react-surface',
          value: 'live-react-surface'
        },
        {
          key: 'document',
          pluginId: 'openpencil-live-react-surface',
          value: JSON.stringify({
            component: 'orbit-lab',
            runtime: 'app-owned-react',
            schemaVersion: 1,
            state: { energy: 1.4, paused: false, tilt: -10 }
          })
        }
      ],
      strokes: [],
      width: 720,
      x: 140,
      y: 120
    })
    store.select([frame.id])
    store.requestRender()
    return frame.id
  })

  await editor.page.getByRole('tab', { name: 'Code' }).click()
  await expect(editor.page.getByTestId('code-object-code-panel')).toBeVisible()
  await expect(editor.page.getByTestId('code-object-source')).toHaveValue(/OrbitLabCodeObject/)
  await expect(editor.page.getByText('Selection code')).toHaveCount(0)
  await expect(editor.page.getByTestId('code-panel-add-code-object')).toHaveCount(0)

  await expect
    .poll(() =>
      editor.page.evaluate((id) => {
        const node = window.openPencil?.getStore?.().graph.getNode(id)
        const raw = node?.pluginData.find(
          (entry) => entry.pluginId === 'openpencil-code-object' && entry.key === 'document'
        )?.value
        const document = raw ? JSON.parse(raw) : null
        return {
          component: document?.component ?? null,
          definitionId: document?.definitionId ?? null,
          frameId: node?.id ?? null,
          hasSource:
            typeof document?.source === 'string' && document.source.includes('OrbitLabCodeObject'),
          name: document?.name ?? null,
          props: document?.props ?? null,
          type: node?.type ?? null
        }
      }, frameId)
    )
    .toEqual({
      component: 'orbit-lab',
      definitionId: 'openpencil.orbit-lab',
      frameId,
      hasSource: true,
      name: 'Orbit lab',
      props: {},
      type: 'FRAME'
    })

  const wrapper = editor.page
    .locator('[data-code-object-mode]')
    .filter({ has: editor.page.getByTestId('code-object-orbit-lab') })
  await editor.page.getByTestId('code-object-design-hit-target').dblclick()
  await expect(wrapper).toHaveAttribute('data-code-object-mode', 'interact')
  await editor.page.getByTestId('code-object-orbit-toggle').click()
  await expect(editor.page.getByTestId('code-object-orbit-toggle')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await editor.page.keyboard.press('Escape')
  await expect(wrapper).toHaveAttribute('data-code-object-mode', 'design')
  await expect(editor.page.locator('iframe')).toHaveCount(0)
})
