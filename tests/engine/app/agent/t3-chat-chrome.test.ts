import { describe, expect, test } from 'bun:test'

import {
  detectT3ComposerTrigger,
  filterT3ComposerItems,
  replaceT3ComposerTrigger,
  resolveT3ThreadStatus,
  summarizeT3ThreadStatuses,
  T3_COMPOSER_COMMANDS,
  T3_COMPOSER_SKILLS
} from '@/components/ai-elements/t3-chat-chrome.logic'

describe('T3 Code thread statuses', () => {
  test('prioritizes approval, input, active, and unseen completion states', () => {
    const base = { pendingUiRequests: [], recentUpdate: '', state: 'completed' as const }
    expect(resolveT3ThreadStatus(base, { unread: true })).toMatchObject({
      label: 'Completed',
      tone: 'emerald'
    })
    expect(resolveT3ThreadStatus({ ...base, state: 'running' })).toMatchObject({
      label: 'Working',
      pulse: true
    })
    expect(
      resolveT3ThreadStatus({ ...base, recentUpdate: 'Provider failed', state: 'stopped' })
    ).toBeNull()
    expect(
      resolveT3ThreadStatus({
        ...base,
        recentUpdate: 'Pi stopped responding.',
        state: 'needs_attention'
      })
    ).toMatchObject({ label: 'Failed', pulse: false, tone: 'red' })
    expect(
      resolveT3ThreadStatus({
        ...base,
        pendingUiRequests: [
          { id: 'approval', method: 'confirm', requestedAt: '', title: 'Approve' }
        ]
      })
    ).toMatchObject({ label: 'Pending Approval', tone: 'amber' })
    expect(
      resolveT3ThreadStatus({
        ...base,
        pendingUiRequests: [{ id: 'input', method: 'select', requestedAt: '', title: 'Choose' }]
      })
    ).toMatchObject({ label: 'Awaiting Input', tone: 'indigo' })
  })

  test('summarizes child activity as working, then failed, then completed', () => {
    const completed = { label: 'Completed', pulse: false, tone: 'emerald' as const }
    const failed = { label: 'Failed', pulse: false, tone: 'red' as const }
    const working = { label: 'Working', pulse: true, tone: 'sky' as const }

    expect(summarizeT3ThreadStatuses([completed])).toEqual(completed)
    expect(summarizeT3ThreadStatuses([completed, failed])).toEqual(failed)
    expect(summarizeT3ThreadStatuses([completed, failed, working])).toEqual(working)
    expect(
      summarizeT3ThreadStatuses([{ label: 'Pending Approval', pulse: false, tone: 'amber' }])
    ).toBeUndefined()
  })
})

describe('T3 Code composer commands', () => {
  test('detects slash commands, skills, and workspace paths at the cursor', () => {
    expect(detectT3ComposerTrigger('/mod', 4)).toEqual({
      kind: 'slash-command',
      query: 'mod',
      rangeEnd: 4,
      rangeStart: 0
    })
    expect(detectT3ComposerTrigger('/skill:open', 11)).toMatchObject({
      kind: 'skill',
      query: 'open'
    })
    expect(detectT3ComposerTrigger('Review @src/app', 15)).toMatchObject({
      kind: 'path',
      query: 'src/app',
      rangeStart: 7
    })
  })

  test('filters and replaces the active trigger without disturbing the prompt', () => {
    expect(filterT3ComposerItems(T3_COMPOSER_COMMANDS, 'model').map((item) => item.id)).toEqual([
      'command:model'
    ])
    expect(filterT3ComposerItems(T3_COMPOSER_SKILLS, 'pencil')).toHaveLength(1)
    expect(
      replaceT3ComposerTrigger(
        'Review @src/app tomorrow',
        { rangeEnd: 15, rangeStart: 7 },
        '@src/app.css '
      )
    ).toEqual({ cursor: 20, text: 'Review @src/app.css  tomorrow' })
  })

  test('keeps the command drawer separate from the prompt shell', async () => {
    const styles = await Bun.file('src/app.css').text()
    const menu = styles.match(/\.t3-composer-command-menu \{([\s\S]*?)\n\}/)?.[1] ?? ''
    const list = styles.match(/\.t3-composer-command-list \{([\s\S]*?)\n\}/)?.[1] ?? ''

    expect(menu).toContain('margin-bottom: 6px')
    expect(menu).toContain('border-radius: 11px')
    expect(menu).not.toContain('margin-bottom: -13px')
    expect(menu).not.toContain('border-bottom-color: transparent')
    expect(list).toContain('padding: 7px')
  })
})
