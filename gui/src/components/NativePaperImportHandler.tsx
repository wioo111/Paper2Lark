import { FileCheck2, LoaderCircle, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { importMobileTransferPackage } from '@/utils/mobilePaperPackage'
import {
  addNativePaperImportListener,
  canReceiveNativePaperImports,
  consumePendingNativePaperImport,
  getPendingNativePaperImport,
  pendingNativeImportToFile,
} from '@/utils/nativePaperImport'
import { setApiBaseUrl } from '@/utils/apiBase'

export function NativePaperImportHandler() {
  const [status, setStatus] = useState<'idle' | 'importing' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const importPending = useCallback(async () => {
    const pending = await getPendingNativePaperImport()
    if (!pending) return
    setStatus('importing')
    setMessage(pending.error ? '系统分享的文件无法读取' : `正在导入 ${pending.name || '文献包'}…`)
    try {
      const file = await pendingNativeImportToFile(pending)
      const papers = await importMobileTransferPackage(file)
      await consumePendingNativePaperImport()
      setApiBaseUrl('')
      setStatus('done')
      setMessage(papers.length === 1 ? `《${papers[0].title}》已加入书架` : `${papers.length} 篇论文已加入书架`)
      window.setTimeout(() => window.location.assign('/'), 900)
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : '文献包导入失败')
    }
  }, [])

  useEffect(() => {
    if (!canReceiveNativePaperImports()) return
    void importPending()
    let handle: Awaited<ReturnType<typeof addNativePaperImportListener>> | null = null
    void addNativePaperImportListener(() => void importPending()).then((listenerHandle) => {
      handle = listenerHandle
    })
    return () => {
      void handle?.remove()
    }
  }, [importPending])

  if (status === 'idle') return null

  function handleClose() {
    void consumePendingNativePaperImport()
    setStatus('idle')
  }

  return (
    <div className="cark-overlay fixed inset-0 z-[120] flex items-center justify-center px-5">
      <div className="cark-panel cark-elevated w-full max-w-sm rounded-[28px] p-6 text-center">
        <div className={`mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl ${
          status === 'error' ? 'bg-rose-400/10 text-rose-200' : 'cark-button-accent'
        }`}>
          {status === 'importing' ? <LoaderCircle className="h-5 w-5 animate-spin" /> : status === 'done' ? <FileCheck2 className="h-5 w-5" /> : <X className="h-5 w-5" />}
        </div>
        <p className="cark-title mt-4 text-base font-medium">{status === 'error' ? '无法导入' : status === 'done' ? '导入完成' : '正在校验文献包'}</p>
        <p className="cark-muted mt-2 break-words text-sm leading-6">{message}</p>
        {status === 'error' ? (
          <div className="mt-5 flex gap-3">
            <button type="button" onClick={handleClose} className="cark-button-secondary flex-1 rounded-full px-4 py-2.5 text-sm">关闭</button>
            <button type="button" onClick={() => void importPending()} className="cark-button-accent flex-1 rounded-full px-4 py-2.5 text-sm">重试</button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
