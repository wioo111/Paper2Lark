// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  deleteImportedPaper,
  downloadPaperForOffline,
  isPaperOffline,
  registerOfflinePaper,
  updateOfflinePaperSummary,
} from '@/utils/offlineLibrary'
import type { PaperDetail } from '@/types'

describe('offline paper library', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('downloads paper data and referenced images into the device cache', async () => {
    const put = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'caches', {
      configurable: true,
      value: { open: vi.fn().mockResolvedValue({ put }) },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    const detail = {
      id: 'paper-1',
      title: 'Paper One',
      images: [],
      markdown: { linearized: '![figure](images/figure.png)' },
    } as unknown as PaperDetail

    const result = await downloadPaperForOffline(detail)

    expect(result.total).toBe(5)
    expect(isPaperOffline('paper-1')).toBe(true)
    expect(fetch).toHaveBeenCalledWith('/api/papers', { credentials: 'same-origin' })
    expect(fetch).toHaveBeenCalledWith('/api/media/paper-1?path=auto%2Fimages%2Ffigure.png', { credentials: 'same-origin' })
    vi.unstubAllGlobals()
  })

  it('updates favorites and reading status without contacting the computer', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const cached = new Response(JSON.stringify([{ id: 'paper-1', title: 'Paper One', favorite: false }]))
    const put = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'caches', {
      configurable: true,
      value: { open: vi.fn().mockResolvedValue({ match: vi.fn().mockResolvedValue(cached), put }) },
    })

    const updated = await updateOfflinePaperSummary('paper-1', { favorite: true, readingStatus: 'reading' })

    expect(updated).toMatchObject({ favorite: true, readingStatus: 'reading' })
    expect(put).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('deletes an imported paper, its assets, and its local reading state', async () => {
    const listUrl = new URL('/api/papers', window.location.origin).href
    const detailUrl = new URL('/api/papers/paper-1', window.location.origin).href
    const assetUrl = new URL('/api/media/shared-image', window.location.origin).href
    const stored = new Map<string, Response>([
      [listUrl, new Response(JSON.stringify([
        { id: 'paper-1', title: 'Paper One' },
        { id: 'paper-2', title: 'Paper Two' },
      ]))],
      [detailUrl, new Response('{}')],
      [assetUrl, new Response('image')],
    ])
    const cache = {
      keys: vi.fn(async () => [...stored.keys()].map((url) => new Request(url))),
      match: vi.fn(async (input: RequestInfo | URL) => stored.get(String(input))?.clone()),
      put: vi.fn(async (input: RequestInfo | URL, response: Response) => {
        stored.set(String(input), response.clone())
      }),
      delete: vi.fn(async (input: RequestInfo | URL) => stored.delete(input instanceof Request ? input.url : String(input))),
    }
    Object.defineProperty(window, 'caches', {
      configurable: true,
      value: { open: vi.fn().mockResolvedValue(cache) },
    })
    registerOfflinePaper({
      id: 'paper-1',
      title: 'Paper One',
      downloadedAt: '2026-07-24T00:00:00Z',
      assetUrls: ['/api/media/shared-image'],
    })
    localStorage.setItem('cark-offline-reading-state:paper-1', '{"paperId":"paper-1"}')

    await deleteImportedPaper('paper-1')

    expect(JSON.parse(await stored.get(listUrl)!.text())).toEqual([{ id: 'paper-2', title: 'Paper Two' }])
    expect(stored.has(detailUrl)).toBe(false)
    expect(stored.has(assetUrl)).toBe(false)
    expect(isPaperOffline('paper-1')).toBe(false)
    expect(localStorage.getItem('cark-offline-reading-state:paper-1')).toBeNull()
  })
})
