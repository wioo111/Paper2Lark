import { Archive, FileUp, LoaderCircle } from 'lucide-react'
import { useRef, useState } from 'react'

import { postImportPaperPackage } from '@/api'
import type { PaperSummary } from '@/types'
import {
  createMobileLibraryPackage,
  downloadMobilePaperPackage,
  extractPaperPackages,
  type PackageProgress,
} from '@/utils/mobilePaperPackage'

interface LibraryTransferActionsProps {
  papers: PaperSummary[]
  onImported: () => Promise<void> | void
}

export function LibraryTransferActions({ papers, onImported }: LibraryTransferActionsProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'idle' | 'exporting' | 'importing'>('idle')
  const [progress, setProgress] = useState<PackageProgress | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function handleExport() {
    setMode('exporting')
    setProgress(null)
    setMessage(null)
    try {
      const result = await createMobileLibraryPackage(papers, setProgress)
      downloadMobilePaperPackage(result.blob, result.fileName)
      setMessage(`已打包 ${result.manifest.paperCount} 篇论文`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '整库打包失败')
    } finally {
      setMode('idle')
    }
  }

  async function handleImport(file: File | undefined) {
    if (!file) return
    setMode('importing')
    setProgress(null)
    setMessage(null)
    try {
      const packages = await extractPaperPackages(file)
      for (const [index, paperPackage] of packages.entries()) {
        const imported = await postImportPaperPackage(paperPackage)
        setProgress({ completed: index + 1, total: packages.length, title: imported.title })
      }
      await onImported()
      setMessage(`已导入 ${packages.length} 篇论文`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '整库导入失败')
    } finally {
      setMode('idle')
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const busy = mode !== 'idle'
  const progressText = progress ? `${progress.completed}/${progress.total}` : null

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".carklibrary,.carkpaper,application/vnd.cark.library+zip,application/vnd.cark.paper+zip,application/zip"
        className="hidden"
        onChange={(event) => void handleImport(event.target.files?.[0])}
      />
      <button
        type="button"
        disabled={busy || papers.length === 0}
        onClick={() => void handleExport()}
        className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        title="把当前论文库打包成一个可迁移文件"
      >
        {mode === 'exporting' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
        {mode === 'exporting' ? `打包中 ${progressText ?? ''}`.trim() : '整库打包'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        title="从整库包或单篇文献包导入"
      >
        {mode === 'importing' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
        {mode === 'importing' ? `导入中 ${progressText ?? ''}`.trim() : '导入文献库'}
      </button>
      {message ? <span className="cark-faint max-w-56 text-right text-xs">{message}</span> : null}
    </div>
  )
}
