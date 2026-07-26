import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

interface PendingPaperImport {
  path?: string
  name?: string
  type?: string
  size?: number
  error?: string
}

interface CarkImportPlugin {
  getPendingImport(): Promise<PendingPaperImport | Record<string, never>>
  consumePendingImport(): Promise<void>
  addListener(
    eventName: 'paperImportAvailable',
    listener: (event: PendingPaperImport) => void,
  ): Promise<PluginListenerHandle>
}

const CarkImport = registerPlugin<CarkImportPlugin>('CarkImport')

export function canReceiveNativePaperImports() {
  return Capacitor.getPlatform() === 'android'
}

export async function getPendingNativePaperImport() {
  if (!canReceiveNativePaperImports()) return null
  const pending = await CarkImport.getPendingImport()
  return ('path' in pending || 'error' in pending) ? pending as PendingPaperImport : null
}

export async function pendingNativeImportToFile(pending: PendingPaperImport) {
  if (pending.error) throw new Error(pending.error)
  if (!pending.path) throw new Error('系统没有提供可读取的文献包')
  const response = await fetch(Capacitor.convertFileSrc(pending.path))
  if (!response.ok) throw new Error(`无法读取系统分享的文件（${response.status}）`)
  const blob = await response.blob()
  return new File([blob], pending.name || 'paper.carkpaper', {
    type: pending.type || 'application/vnd.cark.paper+zip',
  })
}

export function consumePendingNativePaperImport() {
  return CarkImport.consumePendingImport()
}

export function addNativePaperImportListener(listener: (event: PendingPaperImport) => void) {
  return CarkImport.addListener('paperImportAvailable', listener)
}
