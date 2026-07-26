// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createOfflineAnnotationComment,
  createOfflinePaperAnnotation,
  deleteOfflinePaperAnnotation,
  updateOfflineAnnotationComment,
  updateOfflinePaperAnnotation,
} from '@/utils/offlineAnnotations'

describe('offline annotations', () => {
  const stored = new Map<string, Response>()

  beforeEach(() => {
    stored.clear()
    stored.set(new URL('/api/papers', window.location.origin).href, new Response(JSON.stringify([
      { id: 'paper-1', title: 'Paper One', annotationCount: 0 },
    ])))
    Object.defineProperty(window, 'caches', {
      configurable: true,
      value: {
        open: vi.fn().mockResolvedValue({
          match: vi.fn(async (input: RequestInfo | URL) => stored.get(String(input))?.clone()),
          put: vi.fn(async (input: RequestInfo | URL, response: Response) => stored.set(String(input), response.clone())),
        }),
      },
    })
  })

  it('creates, edits, archives, and deletes annotations entirely in the device cache', async () => {
    let annotations = await createOfflinePaperAnnotation('paper-1', {
      view: 'linearized',
      quote: 'A useful result',
      anchorTop: 0.25,
      anchorHeight: 0.03,
      initialComment: { authorType: 'user', authorLabel: '我', content: 'First note' },
    })
    const annotationId = annotations[0].id
    const firstCommentId = annotations[0].comments[0].id

    annotations = await createOfflineAnnotationComment('paper-1', annotationId, {
      authorType: 'user',
      authorLabel: '我',
      content: 'Second note',
    })
    expect(annotations[0].comments).toHaveLength(2)

    annotations = await updateOfflineAnnotationComment('paper-1', annotationId, firstCommentId, {
      content: 'Edited note',
    })
    expect(annotations[0].comments[0]).toMatchObject({ content: 'Edited note', preview: 'Edited note' })

    annotations = await updateOfflinePaperAnnotation('paper-1', annotationId, { archived: true })
    expect(annotations[0]).toMatchObject({ archived: true })
    const papersAfterArchive = await stored.get(new URL('/api/papers', window.location.origin).href)!.clone().json()
    expect(papersAfterArchive).toEqual([expect.objectContaining({ annotationCount: 0 })])

    annotations = await deleteOfflinePaperAnnotation('paper-1', annotationId)
    expect(annotations).toEqual([])
  })
})
