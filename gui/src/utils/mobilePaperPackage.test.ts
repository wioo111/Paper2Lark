// @vitest-environment jsdom

import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchPaperAnnotations, fetchPaperDetail, fetchReadingState } from '@/api'
import type { PaperSummary } from '@/types'
import {
  createMobileLibraryPackage,
  createMobilePaperPackage,
  extractPaperPackages,
  importMobilePaperPackage,
} from '@/utils/mobilePaperPackage'

vi.mock('@/api', () => ({
  fetchPaperAnnotations: vi.fn(),
  fetchPaperDetail: vi.fn(),
  fetchReadingState: vi.fn(),
}))

function packageFile(manifest: object, extraFiles: Record<string, Uint8Array> = {}) {
  const bytes = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), ...extraFiles })
  const file = new File([bytes as BlobPart], 'paper.carkpaper', { type: 'application/vnd.cark.paper+zip' })
  if (!file.arrayBuffer) {
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer })
  }
  return file
}

function validManifest() {
  return {
    format: 'cark-paper-package',
    version: 1,
    createdAt: '2026-07-19T00:00:00Z',
    paper: {
      summary: {
        id: 'paper-1', title: 'Offline paper', taskId: null, updatedAt: '2026-07-19T00:00:00Z',
        availableViews: ['linearized'], hasImages: false,
      },
      detail: {
        id: 'paper-1', title: 'Offline paper', taskId: null, updatedAt: '2026-07-19T00:00:00Z',
        availableViews: ['linearized'], hasImages: false, rootDir: '', files: {},
        markdown: { linearized: '# Offline paper' }, images: [], blocks: [],
        stats: { headingCount: 1, imageCount: 0, tableCount: 0, formulaCount: 0, paragraphCount: 0, blockCount: 0 },
      },
      annotations: [],
      readingState: { paperId: 'paper-1', view: 'linearized', scrollY: 0 },
    },
    assets: [],
  }
}

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('mobile paper package import', () => {
  it('validates and installs an offline paper into the app cache', async () => {
    const stored = new Map<string, Response>()
    const cache = {
      match: vi.fn(async (input: RequestInfo | URL) => stored.get(String(input))?.clone()),
      put: vi.fn(async (input: RequestInfo | URL, response: Response) => { stored.set(String(input), response.clone()) }),
    }
    vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue(cache) })

    await expect(importMobilePaperPackage(packageFile(validManifest()))).resolves.toMatchObject({ id: 'paper-1' })

    const papersResponse = stored.get('http://localhost:3000/api/papers') ?? [...stored.entries()].find(([key]) => key.endsWith('/api/papers'))?.[1]
    expect(await papersResponse?.json()).toEqual([expect.objectContaining({ id: 'paper-1', title: 'Offline paper' })])
    expect(JSON.parse(localStorage.getItem('cark-offline-library-v1') ?? '[]')).toEqual([
      expect.objectContaining({ id: 'paper-1' }),
    ])
  })

  it('rejects a package whose paper identities disagree', async () => {
    const manifest = validManifest()
    manifest.paper.detail.id = 'paper-2'
    vi.stubGlobal('caches', { open: vi.fn() })

    await expect(importMobilePaperPackage(packageFile(manifest))).rejects.toThrow('文献包论文身份不一致')
    expect(caches.open).not.toHaveBeenCalled()
  })

  it('rejects a corrupt file instead of reporting success', async () => {
    const file = new File([strToU8('not a zip') as BlobPart], 'broken.carkpaper')
    if (!file.arrayBuffer) Object.defineProperty(file, 'arrayBuffer', { value: async () => strToU8('not a zip').buffer })

    await expect(importMobilePaperPackage(file)).rejects.toThrow('文献包已损坏')
  })
})

describe('mobile paper package export', () => {
  it('creates a transferable package from a paper without requiring server access on the phone', async () => {
    const manifest = validManifest()
    const summary = manifest.paper.summary as PaperSummary
    vi.mocked(fetchPaperDetail).mockResolvedValue(manifest.paper.detail as never)
    vi.mocked(fetchPaperAnnotations).mockResolvedValue([])
    vi.mocked(fetchReadingState).mockResolvedValue(manifest.paper.readingState as never)

    const result = await createMobilePaperPackage(summary)

    expect(result.fileName).toBe('Offline-paper.carkpaper')
    expect(result.blob.size).toBeGreaterThan(0)
    expect(result.manifest.paper.summary.id).toBe('paper-1')
  })

  it('wraps the whole library in a transferable and verifiable archive', async () => {
    const manifest = validManifest()
    const summary = manifest.paper.summary as PaperSummary
    vi.mocked(fetchPaperDetail).mockResolvedValue(manifest.paper.detail as never)
    vi.mocked(fetchPaperAnnotations).mockResolvedValue([])
    vi.mocked(fetchReadingState).mockResolvedValue(manifest.paper.readingState as never)

    const result = await createMobileLibraryPackage([summary])
    const file = new File([result.blob], result.fileName, { type: 'application/vnd.cark.library+zip' })
    const packages = await extractPaperPackages(file)

    expect(result.fileName).toMatch(/^cark-library-.*\.carklibrary$/)
    expect(result.manifest.paperCount).toBe(1)
    expect(packages).toHaveLength(1)
    expect(packages[0].name).toMatch(/\.carkpaper$/)
  })
})
