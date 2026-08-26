import { describe, expect, test } from 'bun:test'

import {
  appendDraftAttachments,
  carriesAttachmentDrag,
  readAttachmentDrag,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT
} from '@/app/agent-chat/attachments'
import { BROWSER_CAPTURE_DRAG_TYPE } from '@/app/browser-inspector/drag'

function fakeDataTransfer(options: { files?: File[]; types?: string[] }): DataTransfer {
  return {
    clearData: () => {},
    dropEffect: 'none',
    effectAllowed: 'all',
    files: options.files ?? ([] as unknown as FileList),
    getData: () => '',
    items: [] as unknown as DataTransferItemList,
    setData: () => {},
    setDragImage: () => {},
    types: options.types ?? []
  } as DataTransfer
}

describe('agent-chat attachments', () => {
  test('deduplicates identical files and respects count limit', () => {
    const file1 = new File(['hello'], 'test1.png', { type: 'image/png', lastModified: 1000 })
    const file2 = new File(['world'], 'test2.png', { type: 'image/png', lastModified: 2000 })
    const file1Duplicate = new File(['hello'], 'test1.png', { type: 'image/png', lastModified: 1000 })

    const result1 = appendDraftAttachments([], [file1, file2, file1Duplicate])
    expect(result1.attachments.length).toBe(2)
    expect(result1.attachments[0]).toBe(file1)
    expect(result1.attachments[1]).toBe(file2)

    // Test max limit
    const file3 = new File(['3'], 'test3.png', { type: 'image/png', lastModified: 3000 })
    const file4 = new File(['4'], 'test4.png', { type: 'image/png', lastModified: 4000 })
    const file5 = new File(['5'], 'test5.png', { type: 'image/png', lastModified: 5000 })
    const file6 = new File(['6'], 'test6.png', { type: 'image/png', lastModified: 6000 })

    const result2 = appendDraftAttachments(result1.attachments, [file3, file4, file5, file6])
    expect(result2.attachments.length).toBe(MAX_ATTACHMENT_COUNT)
    expect(result2.error).toContain('You can attach up to 5 files')
  })

  test('flags oversized files', () => {
    const hugeBytes = new Uint8Array(MAX_ATTACHMENT_BYTES + 10)
    const hugeFile = new File([hugeBytes], 'huge.png', { type: 'image/png' })

    const result = appendDraftAttachments([], [hugeFile])
    expect(result.attachments.length).toBe(0)
    expect(result.error).toContain('larger than 100 MB')
  })

  test('detects drag with files and browser captures', () => {
    expect(carriesAttachmentDrag(null)).toBe(false)

    const fileTransfer = fakeDataTransfer({ types: ['Files'] })
    expect(carriesAttachmentDrag(fileTransfer)).toBe(true)

    const captureTransfer = fakeDataTransfer({ types: [BROWSER_CAPTURE_DRAG_TYPE] })
    expect(carriesAttachmentDrag(captureTransfer)).toBe(true)

    const otherTransfer = fakeDataTransfer({ types: ['text/plain'] })
    expect(carriesAttachmentDrag(otherTransfer)).toBe(false)
  })

  test('reads files from dataTransfer', () => {
    const file1 = new File(['data'], 'doc.pdf', { type: 'application/pdf' })
    const dataTransfer = fakeDataTransfer({
      files: [file1],
      types: ['Files']
    })

    const read = readAttachmentDrag(dataTransfer)
    expect(read.length).toBe(1)
    expect(read[0]?.name).toBe('doc.pdf')
  })
})
