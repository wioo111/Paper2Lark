import { FileUp, LoaderCircle } from 'lucide-react'
import { useRef, useState } from 'react'

import type { PaperSummary } from '@/types'
import { setApiBaseUrl } from '@/utils/apiBase'
import { importMobileTransferPackage } from '@/utils/mobilePaperPackage'

interface MobilePaperImportButtonProps {
  compact?: boolean
  onImported?: (papers: PaperSummary[]) => void
}

export function MobilePaperImportButton({ compact = false, onImported }: MobilePaperImportButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File | undefined) {
    if (!file) return
    setImporting(true)
    setError(null)
    try {
      const papers = await importMobileTransferPackage(file)
      setApiBaseUrl('')
      onImported?.(papers)
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : '文献包导入失败')
    } finally {
      setImporting(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className={compact ? '' : 'w-full'}>
      <input
        ref={inputRef}
        type="file"
        accept=".carklibrary,.carkpaper,application/vnd.cark.library+zip,application/vnd.cark.paper+zip,application/zip,application/octet-stream"
        className="hidden"
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
      <button
        type="button"
        disabled={importing}
        onClick={() => inputRef.current?.click()}
        className={compact
          ? 'cark-mobile-server-button cark-elevated inline-flex h-10 items-center gap-2 rounded-full px-3 text-xs disabled:opacity-60'
          : 'cark-button-accent inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm disabled:opacity-60'}
      >
        {importing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
        {importing ? '正在校验并导入' : compact ? '导入文献包' : '选择 .carklibrary / .carkpaper'}
      </button>
      {error ? <p className="mt-2 max-w-[320px] text-xs text-rose-300">{error}</p> : null}
    </div>
  )
}
