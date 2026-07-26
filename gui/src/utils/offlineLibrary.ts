import type { PaperDetail, PaperSummary, UpdatePaperLibraryInput } from '@/types'
import { resolveMediaUrl } from '@/utils/markdown'
import { withApiBaseUrl } from '@/utils/apiBase'
import { removeOfflineReadingState } from '@/utils/offlineReadingState'

export const PAPER_CACHE_NAME = 'cark-paper-v1'
const OFFLINE_LIBRARY_KEY = 'cark-offline-library-v1'

export interface OfflinePaperEntry {
  id: string
  title: string
  downloadedAt: string
  assetUrls?: string[]
  packageBytes?: number
}

function readLibrary(): OfflinePaperEntry[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(OFFLINE_LIBRARY_KEY) ?? '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function writeLibrary(entries: OfflinePaperEntry[]) {
  window.localStorage.setItem(OFFLINE_LIBRARY_KEY, JSON.stringify(entries))
  window.dispatchEvent(new CustomEvent('cark-offline-library-change'))
}

export function registerOfflinePaper(entry: OfflinePaperEntry) {
  writeLibrary([entry, ...readLibrary().filter((item) => item.id !== entry.id)])
}

export function listOfflinePapers() {
  return readLibrary()
}

export function isPaperOffline(paperId: string) {
  return readLibrary().some((entry) => entry.id === paperId)
}

function localCacheUrl(path: string) {
  return new URL(path, window.location.origin).href
}

export async function updateOfflinePaperSummary(paperId: string, payload: UpdatePaperLibraryInput) {
  const cache = await window.caches.open(PAPER_CACHE_NAME)
  const listUrl = localCacheUrl('/api/papers')
  const response = await cache.match(listUrl)
  if (!response) throw new Error('本机书架数据不存在')
  const papers = await response.json() as PaperSummary[]
  const current = papers.find((paper) => paper.id === paperId)
  if (!current) throw new Error('本机书架中没有这篇论文')
  const updated: PaperSummary = {
    ...current,
    ...payload,
    libraryUpdatedAt: new Date().toISOString(),
  }
  await cache.put(listUrl, new Response(JSON.stringify([
    ...papers.map((paper) => paper.id === paperId ? updated : paper),
  ]), { headers: { 'Content-Type': 'application/json; charset=utf-8' } }))
  return updated
}

function markdownImageSources(markdown: string) {
  const sources = new Set<string>()
  for (const match of markdown.matchAll(/!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g)) {
    const source = match[1] || match[2]
    if (source) sources.add(source)
  }
  for (const match of markdown.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    if (match[1]) sources.add(match[1])
  }
  return [...sources]
}

async function cacheUrl(cache: Cache, url: string) {
  const resolvedUrl = withApiBaseUrl(url) as string
  const response = await fetch(resolvedUrl, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`下载失败 (${response.status})`)
  await cache.put(resolvedUrl, response.clone())
}

export async function downloadPaperForOffline(detail: PaperDetail) {
  if (!('caches' in window)) throw new Error('当前浏览器不支持离线存储')

  const cache = await window.caches.open(PAPER_CACHE_NAME)
  const paperId = encodeURIComponent(detail.id)
  const urls = new Set<string>([
    '/api/papers',
    `/api/papers/${paperId}`,
    `/api/papers/${paperId}/annotations`,
    `/api/papers/${paperId}/reading-state`,
  ])

  for (const image of detail.images) {
    if (image.url) urls.add(image.url)
  }
  for (const markdown of Object.values(detail.markdown)) {
    for (const source of markdownImageSources(markdown ?? '')) {
      const url = resolveMediaUrl(detail.id, source)
      if (url && !url.startsWith('data:')) urls.add(url)
    }
  }

  const results = await Promise.allSettled([...urls].map((url) => cacheUrl(cache, url)))
  if (results[0]?.status === 'rejected') throw results[0].reason

  const nextEntry: OfflinePaperEntry = {
    id: detail.id,
    title: detail.title,
    downloadedAt: new Date().toISOString(),
  }
  registerOfflinePaper(nextEntry)
  return { downloaded: results.filter((result) => result.status === 'fulfilled').length, total: results.length }
}

export async function removeOfflinePaper(paperId: string) {
  const entry = readLibrary().find((item) => item.id === paperId)
  if ('caches' in window) {
    const cache = await window.caches.open(PAPER_CACHE_NAME)
    const keys = await cache.keys()
    const encodedId = encodeURIComponent(paperId)
    const assetUrls = new Set(entry?.assetUrls ?? [])
    await Promise.all(
      keys
        .filter((request) => {
          const url = new URL(request.url)
          return url.pathname.includes(`/api/papers/${encodedId}`)
            || url.pathname.includes(`/api/media/${encodedId}`)
            || assetUrls.has(`${url.pathname}${url.search}`)
        })
        .map((request) => cache.delete(request)),
    )
  }
  removeOfflineReadingState(paperId)
  writeLibrary(readLibrary().filter((entry) => entry.id !== paperId))
}

export async function deleteImportedPaper(paperId: string) {
  if (!('caches' in window)) {
    removeOfflineReadingState(paperId)
    writeLibrary(readLibrary().filter((entry) => entry.id !== paperId))
    return
  }

  const cache = await window.caches.open(PAPER_CACHE_NAME)
  const listUrl = localCacheUrl('/api/papers')
  const response = await cache.match(listUrl)
  if (response) {
    const papers = await response.json() as PaperSummary[]
    await cache.put(
      listUrl,
      new Response(JSON.stringify(papers.filter((paper) => paper.id !== paperId)), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }),
    )
  }
  await removeOfflinePaper(paperId)
}

export async function clearImportedPapers() {
  for (const entry of readLibrary()) {
    await deleteImportedPaper(entry.id)
  }
}

export async function estimateOfflineLibraryBytes() {
  const entries = readLibrary()
  const recordedBytes = entries.reduce((total, entry) => total + (entry.packageBytes ?? 0), 0)
  if (recordedBytes > 0 && entries.every((entry) => typeof entry.packageBytes === 'number')) {
    return recordedBytes
  }
  if (!('caches' in window)) return recordedBytes

  const cache = await window.caches.open(PAPER_CACHE_NAME)
  const keys = await cache.keys()
  const sizes = await Promise.all(
    keys.map(async (request) => {
      const response = await cache.match(request)
      return response ? (await response.blob()).size : 0
    }),
  )
  return sizes.reduce((total, size) => total + size, 0)
}
