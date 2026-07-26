import { Capacitor } from '@capacitor/core'
import { ArrowRight, BookOpen, CheckCircle2, Circle, LoaderCircle, MessageSquareText, PackageOpen, Star, Tags, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import type { PaperReadingStatus, PaperSummary } from '@/types'
import { formatUpdatedAt } from '@/utils/paper'
import { isPaperOffline } from '@/utils/offlineLibrary'
import { createMobilePaperPackage, downloadMobilePaperPackage } from '@/utils/mobilePaperPackage'

interface PaperListItemProps {
  paper: PaperSummary
  recent?: boolean
  updating?: boolean
  onFavoriteToggle?: (paper: PaperSummary) => void
  onReadingStatusChange?: (paper: PaperSummary, status: PaperReadingStatus) => void
  onTagsEdit?: (paper: PaperSummary) => void
  onDelete?: (paper: PaperSummary) => void
}

const statusOptions: Array<{ value: PaperReadingStatus; label: string }> = [
  { value: 'unread', label: '未读' },
  { value: 'reading', label: '阅读中' },
  { value: 'done', label: '已读' },
]

export function PaperListItem({
  paper,
  recent = false,
  updating = false,
  onFavoriteToggle,
  onReadingStatusChange,
  onTagsEdit,
  onDelete,
}: PaperListItemProps) {
  const nativeApp = Capacitor.isNativePlatform()
  const readingStatus = paper.readingStatus ?? 'unread'
  const tags = paper.tags ?? []
  const offline = isPaperOffline(paper.id)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  async function handlePackageExport() {
    setExporting(true)
    setExportError(null)
    try {
      const result = await createMobilePaperPackage(paper)
      downloadMobilePaperPackage(result.blob, result.fileName)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : '手机文献包导出失败')
    } finally {
      setExporting(false)
    }
  }

  return (
    <article className="cark-card group flex min-w-0 w-full overflow-hidden rounded-[28px] px-5 py-5 transition duration-200 hover:border-[rgba(var(--accent-rgb),0.35)] hover:bg-[var(--surface-soft)]">
      <div className="flex min-w-0 w-full items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {offline ? <span className="cark-chip-accent rounded-full px-2.5 py-1 text-[11px]">已离线</span> : null}
            {recent ? (
              <span className="cark-chip-accent rounded-full px-2 py-1 text-[11px] uppercase tracking-[0.2em]">
                最近阅读
              </span>
            ) : null}
            {paper.favorite ? (
              <span className="cark-chip-accent inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px]">
                <Star className="h-3 w-3 fill-current" />
                收藏
              </span>
            ) : null}
            <span className="cark-button-secondary inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px]">
              {renderStatusIcon(readingStatus)}
              {statusOptions.find((item) => item.value === readingStatus)?.label}
            </span>
          </div>

          <Link to={`/reader/${encodeURIComponent(paper.id)}`} className="block">
            <h3 className="cark-title max-w-full break-all font-serif text-xl">
              {paper.title}
            </h3>
          </Link>

          <p className="cark-muted text-sm">更新于 {formatUpdatedAt(paper.updatedAt)}</p>

          <div className="flex flex-wrap items-center gap-2">
            <span className="cark-faint inline-flex items-center gap-1 text-xs">
              <MessageSquareText className="h-3.5 w-3.5" />
              批注 {paper.annotationCount ?? 0}
            </span>
            <span className="cark-faint inline-flex items-center gap-1 text-xs">
              <BookOpen className="h-3.5 w-3.5" />
              记忆 {paper.memoryCount ?? 0}
            </span>
            {tags.map((tag) => (
              <span key={tag} className="cark-chip-accent rounded-full px-2 py-1 text-[11px]">
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {!nativeApp ? (
              <button
                type="button"
                disabled={exporting}
                onClick={() => void handlePackageExport()}
                aria-label="导出手机文献包"
                title="导出手机文献包"
                className="cark-button-secondary inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exporting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <PackageOpen className="h-4 w-4" />}
                {exporting ? '打包中' : '手机包'}
              </button>
            ) : null}
            <button
              type="button"
              disabled={updating}
              onClick={() => onFavoriteToggle?.(paper)}
              aria-label={paper.favorite ? 'Unfavorite paper' : 'Favorite paper'}
              className={[
                'inline-flex h-9 w-9 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-60',
                paper.favorite ? 'cark-button-accent' : 'cark-button-secondary',
              ].join(' ')}
            >
              <Star className={`h-4 w-4 ${paper.favorite ? 'fill-current' : ''}`} />
            </button>
            <button
              type="button"
              disabled={updating}
              onClick={() => onTagsEdit?.(paper)}
              aria-label="Edit paper tags"
              className="cark-button-secondary inline-flex h-9 w-9 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Tags className="h-4 w-4" />
            </button>
            {nativeApp && onDelete ? (
              <button
                type="button"
                disabled={updating}
                onClick={() => onDelete(paper)}
                aria-label="删除本机文献"
                className="cark-button-secondary inline-flex h-9 w-9 items-center justify-center rounded-full text-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          {exportError ? <p className="max-w-36 text-right text-[11px] text-rose-300">{exportError}</p> : null}

          <select
            value={readingStatus}
            disabled={updating}
            onChange={(event) => onReadingStatusChange?.(paper, event.target.value as PaperReadingStatus)}
            aria-label="Paper reading status"
            className="cark-input rounded-full px-3 py-2 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            {statusOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>

          <Link
            to={`/reader/${encodeURIComponent(paper.id)}`}
            className="cark-faint flex items-center gap-2 transition group-hover:text-[rgba(var(--accent-rgb),0.92)]"
          >
            <span className="text-xs">阅读</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </article>
  )
}

function renderStatusIcon(status: PaperReadingStatus) {
  if (status === 'done') {
    return <CheckCircle2 className="h-3.5 w-3.5" />
  }
  if (status === 'reading') {
    return <BookOpen className="h-3.5 w-3.5" />
  }
  return <Circle className="h-3.5 w-3.5" />
}
