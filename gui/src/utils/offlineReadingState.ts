import type { ReadingState } from '@/types'

const READING_STATE_PREFIX = 'cark-offline-reading-state:'

function keyFor(paperId: string) {
  return `${READING_STATE_PREFIX}${paperId}`
}

export function readOfflineReadingState(paperId: string): ReadingState | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(keyFor(paperId)) ?? 'null')
    return value && typeof value === 'object' ? value as ReadingState : null
  } catch {
    return null
  }
}

export function saveOfflineReadingState(
  paperId: string,
  state: Omit<ReadingState, 'paperId' | 'updatedAt'>,
) {
  const value: ReadingState = {
    ...state,
    paperId,
    updatedAt: new Date().toISOString(),
  }
  window.localStorage.setItem(keyFor(paperId), JSON.stringify(value))
  return value
}

export function removeOfflineReadingState(paperId: string) {
  window.localStorage.removeItem(keyFor(paperId))
}

export function preferNewestReadingState(server: ReadingState | null, local: ReadingState | null) {
  if (!server) return local
  if (!local) return server
  return (local.clientRevision ?? 0) > (server.clientRevision ?? 0) ? local : server
}
