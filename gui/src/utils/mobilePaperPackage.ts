import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import { fetchPaperAnnotations, fetchPaperDetail, fetchReadingState } from '@/api'
import type { PaperAnnotation, PaperDetail, PaperSummary, ReadingState } from '@/types'
import { withApiBaseUrl } from '@/utils/apiBase'
import { PAPER_CACHE_NAME, registerOfflinePaper } from '@/utils/offlineLibrary'
import { resolveMediaUrl } from '@/utils/markdown'

const PACKAGE_FORMAT = 'cark-paper-package'
const PACKAGE_VERSION = 1
const LIBRARY_PACKAGE_FORMAT = 'cark-library-package'
const LIBRARY_PACKAGE_VERSION = 1
const MAX_PACKAGE_BYTES = 512 * 1024 * 1024
const MAX_UNPACKED_BYTES = 1024 * 1024 * 1024
const MAX_LIBRARY_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024
const MAX_LIBRARY_UNPACKED_BYTES = 3 * 1024 * 1024 * 1024

interface PackageAsset {
  url: string
  path: string
  contentType: string
  sha256: string
}

interface MobilePaperManifest {
  format: typeof PACKAGE_FORMAT
  version: typeof PACKAGE_VERSION
  createdAt: string
  paper: {
    summary: PaperSummary
    detail: PaperDetail
    annotations: PaperAnnotation[]
    readingState: ReadingState
  }
  assets: PackageAsset[]
}

interface MobileLibraryManifest {
  format: typeof LIBRARY_PACKAGE_FORMAT
  version: typeof LIBRARY_PACKAGE_VERSION
  createdAt: string
  paperCount: number
  papers: Array<{
    id: string
    title: string
    path: string
    sha256: string
    bytes: number
  }>
}

export interface PackageProgress {
  completed: number
  total: number
  title: string
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

function canonicalApiUrl(value: string) {
  try {
    const url = new URL(value, window.location.origin)
    return url.pathname.startsWith('/api/') ? `${url.pathname}${url.search}` : value
  } catch {
    return value
  }
}

function localCacheUrl(path: string) {
  return new URL(path, window.location.origin).href
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function safeFileName(value: string) {
  const withoutControls = [...value].map((character) => character.charCodeAt(0) < 32 ? '-' : character).join('')
  return withoutControls.replace(/[<>:"/\\|?*]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[-. ]+|[-. ]+$/g, '').slice(0, 80) || 'paper'
}

function jsonBytes(value: unknown) {
  return strToU8(JSON.stringify(value))
}

async function readBlobBytes(blob: Blob) {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer())
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'))
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.readAsArrayBuffer(blob)
  })
}

async function loadAsset(url: string, index: number): Promise<{ asset: PackageAsset; bytes: Uint8Array }> {
  const canonicalUrl = canonicalApiUrl(url)
  if (!canonicalUrl.startsWith('/api/media/')) throw new Error(`不支持打包的资源地址：${url}`)
  const response = await fetch(withApiBaseUrl(canonicalUrl), { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`图片下载失败 (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const extension = canonicalUrl.match(/\.([a-z0-9]{1,8})(?:[?&]|$)/i)?.[1] ?? 'bin'
  return {
    asset: {
      url: canonicalUrl,
      path: `assets/${String(index).padStart(4, '0')}.${extension}`,
      contentType: response.headers.get('Content-Type') || 'application/octet-stream',
      sha256: await sha256(bytes),
    },
    bytes,
  }
}

export async function createMobilePaperPackage(summary: PaperSummary) {
  const [detail, annotations, readingState] = await Promise.all([
    fetchPaperDetail(summary.id),
    fetchPaperAnnotations(summary.id),
    fetchReadingState(summary.id),
  ])
  const urls = new Set<string>()
  for (const image of detail.images) if (image.url) urls.add(canonicalApiUrl(image.url))
  for (const block of detail.blocks) if (block.imageUrl) urls.add(canonicalApiUrl(block.imageUrl))
  for (const markdown of Object.values(detail.markdown)) {
    for (const source of markdownImageSources(markdown ?? '')) {
      const resolved = resolveMediaUrl(detail.id, source)
      if (resolved && !resolved.startsWith('data:')) urls.add(canonicalApiUrl(resolved))
    }
  }

  const loadedAssets = await Promise.all([...urls].map(loadAsset))
  const manifest: MobilePaperManifest = {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    createdAt: new Date().toISOString(),
    paper: { summary, detail, annotations, readingState },
    assets: loadedAssets.map(({ asset }) => asset),
  }
  const files: Record<string, Uint8Array> = { 'manifest.json': jsonBytes(manifest) }
  for (const { asset, bytes } of loadedAssets) files[asset.path] = bytes
  const blob = new Blob([zipSync(files, { level: 6 }) as BlobPart], { type: 'application/vnd.cark.paper+zip' })
  return { blob, fileName: `${safeFileName(summary.title)}.carkpaper`, manifest }
}

export function downloadMobilePaperPackage(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function createMobileLibraryPackage(
  papers: PaperSummary[],
  onProgress?: (progress: PackageProgress) => void,
) {
  if (papers.length === 0) throw new Error('论文库为空，无法打包')
  const files: Record<string, Uint8Array> = {}
  const entries: MobileLibraryManifest['papers'] = []
  for (const [index, paper] of papers.entries()) {
    const packaged = await createMobilePaperPackage(paper)
    const bytes = await readBlobBytes(packaged.blob)
    const path = `papers/${String(index + 1).padStart(4, '0')}-${safeFileName(paper.title)}.carkpaper`
    files[path] = bytes
    entries.push({
      id: paper.id,
      title: paper.title,
      path,
      sha256: await sha256(bytes),
      bytes: bytes.byteLength,
    })
    onProgress?.({ completed: index + 1, total: papers.length, title: paper.title })
  }
  const manifest: MobileLibraryManifest = {
    format: LIBRARY_PACKAGE_FORMAT,
    version: LIBRARY_PACKAGE_VERSION,
    createdAt: new Date().toISOString(),
    paperCount: entries.length,
    papers: entries,
  }
  files['manifest.json'] = jsonBytes(manifest)
  const blob = new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/vnd.cark.library+zip' })
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13)
  return { blob, fileName: `cark-library-${timestamp}.carklibrary`, manifest }
}

function parseManifest(files: Record<string, Uint8Array>): MobilePaperManifest {
  const raw = files['manifest.json']
  if (!raw) throw new Error('文献包缺少 manifest.json')
  let manifest: MobilePaperManifest
  try {
    manifest = JSON.parse(strFromU8(raw)) as MobilePaperManifest
  } catch {
    throw new Error('文献包清单无法解析')
  }
  if (manifest.format !== PACKAGE_FORMAT || manifest.version !== PACKAGE_VERSION) throw new Error('文献包格式或版本不受支持')
  const { summary, detail, annotations, readingState } = manifest.paper ?? {}
  if (!summary?.id || !summary.title || !detail?.id || summary.id !== detail.id) throw new Error('文献包论文身份不一致')
  if (!detail.markdown?.linearized?.trim()) throw new Error('文献包缺少论文正文')
  if (!Array.isArray(annotations) || readingState?.paperId !== summary.id) throw new Error('文献包阅读数据不完整')
  if (!Array.isArray(manifest.assets)) throw new Error('文献包资源清单无效')
  return manifest
}

async function putJson(cache: Cache, path: string, value: unknown) {
  await cache.put(localCacheUrl(path), new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json; charset=utf-8' } }))
}

async function readCachedPapers(cache: Cache) {
  const response = await cache.match(localCacheUrl('/api/papers'))
  if (!response) return [] as PaperSummary[]
  try {
    const value = await response.json() as unknown
    return Array.isArray(value) ? value as PaperSummary[] : []
  } catch {
    return [] as PaperSummary[]
  }
}

export async function importMobilePaperPackage(file: File) {
  if (file.size > MAX_PACKAGE_BYTES) throw new Error('文献包超过 512 MB，拒绝导入')
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(await readBlobBytes(file))
  } catch {
    throw new Error('文献包已损坏或不是有效的 .carkpaper 文件')
  }
  const totalBytes = Object.values(files).reduce((total, bytes) => total + bytes.byteLength, 0)
  if (totalBytes > MAX_UNPACKED_BYTES) throw new Error('文献包解压后超过 1 GB，拒绝导入')
  const manifest = parseManifest(files)

  for (const asset of manifest.assets) {
    if (!asset.url.startsWith('/api/media/') || !asset.path.startsWith('assets/')) throw new Error('文献包包含非法资源路径')
    const bytes = files[asset.path]
    if (!bytes || await sha256(bytes) !== asset.sha256) throw new Error(`文献包资源校验失败：${asset.path}`)
  }

  const cache = await caches.open(PAPER_CACHE_NAME)
  const id = encodeURIComponent(manifest.paper.summary.id)
  const existing = await readCachedPapers(cache)
  const papers = [manifest.paper.summary, ...existing.filter((paper) => paper.id !== manifest.paper.summary.id)]
  await putJson(cache, '/api/papers', papers)
  await putJson(cache, `/api/papers/${id}`, manifest.paper.detail)
  await putJson(cache, `/api/papers/${id}/annotations`, manifest.paper.annotations)
  await putJson(cache, `/api/papers/${id}/reading-state`, manifest.paper.readingState)
  for (const asset of manifest.assets) {
    await cache.put(localCacheUrl(asset.url), new Response(files[asset.path], { headers: { 'Content-Type': asset.contentType } }))
  }
  registerOfflinePaper({
    id: manifest.paper.summary.id,
    title: manifest.paper.summary.title,
    downloadedAt: new Date().toISOString(),
    assetUrls: manifest.assets.map((asset) => asset.url),
    packageBytes: file.size,
  })
  return manifest.paper.summary
}

function libraryManifest(files: Record<string, Uint8Array>): MobileLibraryManifest | null {
  const raw = files['manifest.json']
  if (!raw) return null
  let manifest: MobileLibraryManifest
  try {
    manifest = JSON.parse(strFromU8(raw)) as MobileLibraryManifest
  } catch {
    return null
  }
  return manifest.format === LIBRARY_PACKAGE_FORMAT ? manifest : null
}

export async function extractPaperPackages(file: File) {
  if (!file.name.toLowerCase().endsWith('.carklibrary')) return [file]
  if (file.size > MAX_LIBRARY_PACKAGE_BYTES) throw new Error('整库包超过 2 GB，拒绝导入')
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(await readBlobBytes(file))
  } catch {
    throw new Error('整库包已损坏或不是有效的 .carklibrary 文件')
  }
  const totalBytes = Object.values(files).reduce((total, bytes) => total + bytes.byteLength, 0)
  if (totalBytes > MAX_LIBRARY_UNPACKED_BYTES) throw new Error('整库包解压后超过 3 GB，拒绝导入')
  const manifest = libraryManifest(files)
  if (!manifest || manifest.version !== LIBRARY_PACKAGE_VERSION) throw new Error('整库包格式或版本不受支持')
  if (!Array.isArray(manifest.papers) || manifest.paperCount !== manifest.papers.length || manifest.paperCount === 0) {
    throw new Error('整库包论文清单无效')
  }

  const packages: File[] = []
  for (const entry of manifest.papers) {
    if (!entry.path.startsWith('papers/') || !entry.path.endsWith('.carkpaper') || entry.path.includes('..')) {
      throw new Error('整库包包含非法文献路径')
    }
    const bytes = files[entry.path]
    if (!bytes || bytes.byteLength !== entry.bytes || await sha256(bytes) !== entry.sha256) {
      throw new Error(`整库包文献校验失败：${entry.title}`)
    }
    const paperFile = new File([bytes as BlobPart], entry.path.split('/').pop() || 'paper.carkpaper', {
      type: 'application/vnd.cark.paper+zip',
    })
    if (!paperFile.arrayBuffer) {
      Object.defineProperty(paperFile, 'arrayBuffer', { value: async () => bytes.buffer })
    }
    packages.push(paperFile)
  }
  return packages
}

export async function importMobileTransferPackage(
  file: File,
  onProgress?: (progress: PackageProgress) => void,
) {
  const packages = await extractPaperPackages(file)
  const imported: PaperSummary[] = []
  for (const [index, paperFile] of packages.entries()) {
    const paper = await importMobilePaperPackage(paperFile)
    imported.push(paper)
    onProgress?.({ completed: index + 1, total: packages.length, title: paper.title })
  }
  return imported
}
