import { Database, Info, LockKeyhole, Server, Trash2, UserRoundX, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { getApiBaseUrl, setApiBaseUrl } from '@/utils/apiBase'
import { clearImportedPapers, estimateOfflineLibraryBytes, listOfflinePapers } from '@/utils/offlineLibrary'

interface MobileAppSettingsProps {
  open: boolean
  onClose: () => void
  onLibraryChanged: () => void
}

function formatBytes(value: number | null) {
  if (value === null) return '正在计算'
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

export function MobileAppSettings({ open, onClose, onLibraryChanged }: MobileAppSettingsProps) {
  const [libraryBytes, setLibraryBytes] = useState<number | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const papers = listOfflinePapers()
  const serverUrl = getApiBaseUrl()

  useEffect(() => {
    if (!open) return
    setConfirmingClear(false)
    setError(null)
    setLibraryBytes(null)
    void estimateOfflineLibraryBytes().then(setLibraryBytes).catch(() => setLibraryBytes(0))
  }, [open])

  if (!open) return null

  async function handleClear() {
    setClearing(true)
    setError(null)
    try {
      await clearImportedPapers()
      setLibraryBytes(0)
      setConfirmingClear(false)
      onLibraryChanged()
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : '清理本机文献失败')
    } finally {
      setClearing(false)
    }
  }

  function handleDisconnect() {
    setApiBaseUrl('')
    window.location.reload()
  }

  return (
    <div className="cark-overlay fixed inset-0 z-[110] flex items-end justify-center sm:items-center sm:px-5">
      <section className="cark-panel cark-elevated max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[30px] p-5 sm:rounded-[30px]">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="cark-faint text-xs uppercase tracking-[0.24em]">cark 1.0</p>
            <h2 className="cark-title mt-1 font-serif text-2xl">应用设置</h2>
          </div>
          <button type="button" aria-label="关闭设置" onClick={onClose} className="cark-button-secondary inline-flex h-10 w-10 items-center justify-center rounded-full">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="mt-5 space-y-4">
          <div className="cark-card rounded-[22px] p-4">
            <div className="flex items-start gap-3">
              <Database className="mt-0.5 h-5 w-5 text-[rgba(var(--accent-rgb),0.9)]" />
              <div className="min-w-0 flex-1">
                <p className="cark-title text-sm font-medium">本机文献</p>
                <p className="cark-muted mt-1 text-sm leading-6">{papers.length} 篇 · 约 {formatBytes(libraryBytes)}</p>
                <p className="cark-faint mt-1 text-xs leading-5">论文、图片、批注与阅读位置只保存在当前设备。卸载应用会移除这些数据。</p>
              </div>
            </div>
            {papers.length > 0 ? (
              confirmingClear ? (
                <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/[0.08] p-3">
                  <p className="text-sm leading-6 text-rose-100">确定删除全部 {papers.length} 篇本机文献？此操作无法撤销。</p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" disabled={clearing} onClick={() => setConfirmingClear(false)} className="cark-button-secondary flex-1 rounded-full px-3 py-2 text-xs">取消</button>
                    <button type="button" disabled={clearing} onClick={() => void handleClear()} className="flex-1 rounded-full bg-rose-500 px-3 py-2 text-xs text-white disabled:opacity-60">{clearing ? '正在删除' : '确认删除'}</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmingClear(true)} className="mt-4 inline-flex items-center gap-2 text-xs text-rose-200">
                  <Trash2 className="h-3.5 w-3.5" /> 删除全部本机文献
                </button>
              )
            ) : null}
          </div>

          <div className="cark-card rounded-[22px] p-4">
            <div className="flex items-start gap-3">
              <LockKeyhole className="mt-0.5 h-5 w-5 text-[rgba(var(--accent-rgb),0.9)]" />
              <div>
                <p className="cark-title text-sm font-medium">隐私与网络</p>
                <p className="cark-muted mt-1 text-sm leading-6">离线阅读不会上传论文或行为数据，不含广告、埋点和第三方分析 SDK。只有你主动连接电脑时，应用才访问你填写的 HTTPS 地址。</p>
              </div>
            </div>
          </div>

          <div className="cark-card rounded-[22px] p-4">
            <div className="flex items-start gap-3">
              {serverUrl ? <Server className="mt-0.5 h-5 w-5 text-emerald-300" /> : <UserRoundX className="mt-0.5 h-5 w-5 text-[rgba(var(--accent-rgb),0.9)]" />}
              <div className="min-w-0 flex-1">
                <p className="cark-title text-sm font-medium">{serverUrl ? '已连接个人电脑' : '无需账号'}</p>
                <p className="cark-muted mt-1 break-all text-sm leading-6">{serverUrl || '当前版本不提供账号注册或云端同步，所有基础阅读功能均可离线使用。'}</p>
                {serverUrl ? <button type="button" onClick={handleDisconnect} className="mt-3 text-xs text-rose-200">断开并切换到本机书架</button> : null}
              </div>
            </div>
          </div>

          <div className="cark-card rounded-[22px] p-4">
            <div className="flex items-start gap-3">
              <Info className="mt-0.5 h-5 w-5 text-[rgba(var(--accent-rgb),0.9)]" />
              <div>
                <p className="cark-title text-sm font-medium">关于 cark</p>
                <p className="cark-muted mt-1 text-sm leading-6">面向论文深度阅读的离线随身书架。文献解析和翻译由电脑端完成，移动端专注于可靠、安静的阅读。</p>
                <p className="cark-faint mt-2 text-xs">Android · 版本 1.0.0</p>
              </div>
            </div>
          </div>
        </div>
        {error ? <p className="mt-4 text-sm text-rose-200">{error}</p> : null}
      </section>
    </div>
  )
}
