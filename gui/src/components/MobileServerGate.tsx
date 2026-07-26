import { Capacitor } from '@capacitor/core'
import { LoaderCircle, Server, Wifi } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'

import { MobilePaperImportButton } from '@/components/MobilePaperImportButton'
import { NativePaperImportHandler } from '@/components/NativePaperImportHandler'
import { getApiBaseUrl, normalizeServerUrl, setApiBaseUrl } from '@/utils/apiBase'
import { listOfflinePapers } from '@/utils/offlineLibrary'

export function MobileServerGate({ children }: { children: ReactNode }) {
  const native = Capacitor.isNativePlatform()
  const [configuredUrl, setConfiguredUrl] = useState(getApiBaseUrl)
  const [input, setInput] = useState(configuredUrl)
  const [editing, setEditing] = useState(!configuredUrl && listOfflinePapers().length === 0)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!native) return children

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const url = normalizeServerUrl(input)
    if (!/^https:\/\//i.test(url)) {
      setError('请输入 Tailscale 提供的 HTTPS 地址')
      return
    }
    setTesting(true)
    setError(null)
    try {
      const response = await fetch(`${url}/api/papers`, { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`服务器返回 ${response.status}`)
      await response.json()
      setApiBaseUrl(url)
      setConfiguredUrl(url)
      setEditing(false)
      window.location.reload()
    } catch (connectionError) {
      setError(connectionError instanceof Error ? `连接失败：${connectionError.message}` : '连接失败')
    } finally {
      setTesting(false)
    }
  }

  if (!editing) {
    return (
      <>
        <NativePaperImportHandler />
        {children}
        {window.location.pathname === '/' ? <div
          className="fixed right-3 z-[80] flex flex-col items-end gap-2"
          style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
        >
          <MobilePaperImportButton compact onImported={() => window.location.reload()} />
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="cark-mobile-server-button cark-elevated inline-flex h-10 items-center gap-2 rounded-full px-3 text-xs"
          >
            <Wifi className="h-3.5 w-3.5" />
            {configuredUrl ? '服务器' : '连接电脑（可选）'}
          </button>
        </div> : null}
      </>
    )
  }

  return (
    <>
      <NativePaperImportHandler />
      <main className="cark-page flex min-h-screen items-center justify-center px-5 py-10">
        <form onSubmit={(event) => void handleSubmit(event)} className="cark-panel cark-elevated w-full max-w-[460px] rounded-[30px] p-6">
        <div className="cark-button-accent inline-flex h-12 w-12 items-center justify-center rounded-2xl">
          <Server className="h-5 w-5" />
        </div>
        <h1 className="cark-title mt-5 font-serif text-2xl">导入离线文献包</h1>
        <p className="cark-muted mt-2 text-sm leading-6">把电脑导出的 .carkpaper 文件发到手机，在这里直接选择。导入后阅读不需要电脑，也不需要网络。</p>
        <div className="mt-5">
          <MobilePaperImportButton onImported={() => window.location.reload()} />
        </div>
        <div className="my-6 flex items-center gap-3">
          <span className="h-px flex-1 bg-[var(--border)]" />
          <span className="cark-faint text-xs">可选：连接电脑同步</span>
          <span className="h-px flex-1 bg-[var(--border)]" />
        </div>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="https://电脑名.tailnet.ts.net"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          className="cark-input mt-5 w-full rounded-2xl px-4 py-3 text-sm outline-none"
        />
        {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
        <div className="mt-5 flex gap-3">
          {configuredUrl ? (
            <button type="button" onClick={() => setEditing(false)} className="cark-button-secondary flex-1 rounded-full px-4 py-3 text-sm">取消</button>
          ) : null}
          <button type="submit" disabled={testing} className="cark-button-accent inline-flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-3 text-sm disabled:opacity-60">
            {testing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
            {testing ? '正在连接' : '连接并进入'}
          </button>
        </div>
        </form>
      </main>
    </>
  )
}
