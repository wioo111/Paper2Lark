import { Capacitor } from '@capacitor/core'
import { AlertCircle, RefreshCw, Search, Settings2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  fetchCapabilities,
  fetchMemoryResearchState,
  fetchSearchResults,
  fetchSettings,
  fetchTasks,
  patchPaperLibrary,
  postRetryTask,
  postUploadPdf,
} from '@/api'
import { PaperListItem } from '@/components/PaperListItem'
import { MemoryInbox } from '@/components/MemoryInbox'
import { LibraryTransferActions } from '@/components/LibraryTransferActions'
import { MobileAppSettings } from '@/components/MobileAppSettings'
import { OpenQuestions } from '@/components/OpenQuestions'
import { RecentInsights } from '@/components/RecentInsights'
import { SettingsPanel } from '@/components/SettingsPanel'
import { TaskCenter } from '@/components/TaskCenter'
import { ThemeSwitch } from '@/components/ThemeSwitch'
import { UploadPanel } from '@/components/UploadPanel'
import { ZoteroImportDialog } from '@/components/ZoteroImportDialog'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import type {
  AppCapabilities,
  AppSettings,
  MemoryResearchStatePayload,
  PaperReadingStatus,
  PaperSummary,
  ProcessingTask,
  SearchResult,
  UpdatePaperLibraryInput,
} from '@/types'
import { buildSearchResultHref, matchesQuery } from '@/utils/paper'
import { isNativeOfflineMode } from '@/utils/apiBase'
import { deleteImportedPaper, updateOfflinePaperSummary } from '@/utils/offlineLibrary'

type LibraryFilter = 'all' | 'favorite' | 'annotated' | 'memory' | PaperReadingStatus

const libraryFilterOptions: Array<{ value: LibraryFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'favorite', label: '收藏' },
  { value: 'annotated', label: '有批注' },
  { value: 'memory', label: '有记忆' },
  { value: 'unread', label: '未读' },
  { value: 'reading', label: '阅读中' },
  { value: 'done', label: '已读' },
]

function createFallbackSettings(): AppSettings {
  return {
    mineru: {
      backend: 'local',
      modelVersion: 'pipeline',
      parseMethod: 'auto',
      apiToken: '',
      reuseExistingParse: true,
    },
    translation: {
      enabled: false,
      apiKey: '',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    },
    publish: {
      prepareOnly: true,
      imageMode: 'note',
      folderToken: '',
      appId: '',
      appSecret: '',
    },
    copilot: {
      agents: [
        {
          id: 'agent-default',
          enabled: true,
          name: '共读助手',
          rolePrompt: '你是用户的论文共读伙伴。先准确理解论文，再围绕用户划线句子的上下文给出具体、克制、有判断的评论。',
          apiKey: '',
          baseUrl: 'https://openrouter.ai/api/v1',
          model: '',
        },
      ],
    },
  }
}

export default function Home() {
  const nativeApp = Capacitor.isNativePlatform()
  const nativeOffline = isNativeOfflineMode()
  const [query, setQuery] = useState('')
  const [settings, setSettings] = useState<AppSettings>(createFallbackSettings)
  const [capabilities, setCapabilities] = useState<AppCapabilities | null>(null)
  const [tasks, setTasks] = useState<ProcessingTask[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)
  const [zoteroOpen, setZoteroOpen] = useState(false)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [retryingTaskId, setRetryingTaskId] = useState<string | null>(null)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [researchState, setResearchState] = useState<MemoryResearchStatePayload | null>(null)
  const [researchLoading, setResearchLoading] = useState(false)
  const [researchError, setResearchError] = useState<string | null>(null)
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all')
  const [tagFilter, setTagFilter] = useState('all')
  const [updatingPaperId, setUpdatingPaperId] = useState<string | null>(null)
  const papers = useWorkspaceStore((state) => state.papers)
  const papersLoading = useWorkspaceStore((state) => state.loading)
  const papersError = useWorkspaceStore((state) => state.error)
  const recentPaperIds = useWorkspaceStore((state) => state.recentPaperIds)
  const refreshPapers = useWorkspaceStore((state) => state.refreshPapers)
  const updatePaper = useWorkspaceStore((state) => state.updatePaper)
  const completedTaskIdsRef = useRef<Set<string>>(new Set())
  const hasQuery = query.trim().length > 0
  const uploadBlocked = capabilities === null || !capabilities.ready
  const uploadBlockedReason = capabilities === null
    ? '正在检查这台电脑的可用能力。'
    : capabilities.issues.map((issue) => issue.message).join(' ')

  useEffect(() => {
    document.title = 'cark'
    void refreshPapers()
  }, [refreshPapers])

  const loadResearchState = useCallback(async () => {
    if (nativeOffline) {
      setResearchState(null)
      setResearchError(null)
      setResearchLoading(false)
      return
    }
    setResearchLoading(true)
    setResearchError(null)
    try {
      setResearchState(await fetchMemoryResearchState())
    } catch (loadError) {
      setResearchState(null)
      setResearchError(loadError instanceof Error ? loadError.message : '研究状态加载失败')
    } finally {
      setResearchLoading(false)
    }
  }, [nativeOffline])

  useEffect(() => {
    void loadResearchState()
  }, [loadResearchState])

  useEffect(() => {
    if (nativeOffline) {
      setTasks([])
      setTasksLoading(false)
      setCapabilities(null)
      setBootstrapError(null)
      return
    }
    let cancelled = false

    async function bootstrap() {
      setTasksLoading(true)
      try {
        const [settingsPayload, taskPayload, capabilityPayload] = await Promise.all([
          fetchSettings(),
          fetchTasks(),
          fetchCapabilities(),
        ])
        if (!cancelled) {
          setSettings(settingsPayload)
          setTasks(taskPayload)
          setCapabilities(capabilityPayload)
          setBootstrapError(null)
        }
      } catch (loadError) {
        if (!cancelled) {
          setBootstrapError(loadError instanceof Error ? loadError.message : '工作台加载失败')
        }
      } finally {
        if (!cancelled) {
          setTasksLoading(false)
        }
      }
    }

    void bootstrap()
    const intervalId = window.setInterval(() => {
      void fetchTasks()
        .then((payload) => {
          if (!cancelled) {
            setTasks(payload)
          }
        })
        .catch(() => {})
    }, 1500)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [nativeOffline])

  useEffect(() => {
    const nextCompleted = new Set(completedTaskIdsRef.current)
    let shouldRefresh = false
    for (const task of tasks) {
      if (task.status === 'succeeded' && !nextCompleted.has(task.id)) {
        nextCompleted.add(task.id)
        shouldRefresh = true
      }
    }
    completedTaskIdsRef.current = nextCompleted
    if (shouldRefresh) {
      void refreshPapers()
    }
  }, [refreshPapers, tasks])

  const allTags = useMemo(() => {
    const tags = new Set<string>()
    for (const paper of papers) {
      for (const tag of paper.tags ?? []) {
        tags.add(tag)
      }
    }
    return Array.from(tags).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
  }, [papers])

  useEffect(() => {
    if (tagFilter !== 'all' && !allTags.includes(tagFilter)) {
      setTagFilter('all')
    }
  }, [allTags, tagFilter])

  const filteredPapers = useMemo(
    () =>
      papers.filter((paper) => {
        if (!matchesQuery(paper, query)) {
          return false
        }
        if (libraryFilter === 'favorite' && !paper.favorite) {
          return false
        }
        if (libraryFilter === 'annotated' && (paper.annotationCount ?? 0) === 0) {
          return false
        }
        if (libraryFilter === 'memory' && (paper.memoryCount ?? 0) === 0) {
          return false
        }
        if (
          (libraryFilter === 'unread' || libraryFilter === 'reading' || libraryFilter === 'done') &&
          (paper.readingStatus ?? 'unread') !== libraryFilter
        ) {
          return false
        }
        if (tagFilter !== 'all' && !(paper.tags ?? []).includes(tagFilter)) {
          return false
        }
        return true
      }),
    [libraryFilter, papers, query, tagFilter],
  )

  useEffect(() => {
    const trimmedQuery = query.trim()
    if (!trimmedQuery || nativeOffline) {
      setSearchResults([])
      setSearchLoading(false)
      setSearchError(null)
      return
    }

    let cancelled = false
    setSearchLoading(true)
    setSearchError(null)
    const timerId = window.setTimeout(() => {
      void fetchSearchResults(trimmedQuery)
        .then((payload) => {
          if (!cancelled) {
            setSearchResults(payload)
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setSearchResults([])
            setSearchError(error instanceof Error ? error.message : '搜索失败')
          }
        })
        .finally(() => {
          if (!cancelled) {
            setSearchLoading(false)
          }
        })
    }, 220)

    return () => {
      cancelled = true
      window.clearTimeout(timerId)
    }
  }, [nativeOffline, query])

  const recentPapers = useMemo(() => {
    const paperById = new Map(papers.map((paper) => [paper.id, paper]))
    return recentPaperIds
      .map((id) => paperById.get(id))
      .filter((paper): paper is NonNullable<typeof paper> => Boolean(paper))
      .slice(0, 4)
  }, [papers, recentPaperIds])

  async function handleUpload(files: File[]) {
    if (uploadBlocked) {
      setUploadError(uploadBlockedReason || '当前环境还不能上传')
      return
    }
    const pdfFiles = files.filter((file) => file.name.toLowerCase().endsWith('.pdf'))
    if (pdfFiles.length === 0) {
      setUploadError('请选择 PDF 文件')
      return
    }
    if (pdfFiles.length !== files.length) {
      setUploadError('已忽略非 PDF 文件，只上传 PDF')
    }
    setUploading(true)
    if (pdfFiles.length === files.length) {
      setUploadError(null)
    }
    try {
      const nextTasks: ProcessingTask[] = []
      const failedFiles: string[] = []

      for (const file of pdfFiles) {
        try {
          nextTasks.push(await postUploadPdf(file))
        } catch {
          failedFiles.push(file.name)
        }
      }

      if (nextTasks.length > 0) {
        setTasks((current) => [
          ...nextTasks,
          ...current.filter((item) => !nextTasks.some((task) => task.id === item.id)),
        ])
      }

      if (failedFiles.length > 0) {
        setUploadError(
          failedFiles.length === 1
            ? `${failedFiles[0]} 上传失败`
            : `${failedFiles.length} 个文件上传失败：${failedFiles.slice(0, 3).join('、')}${failedFiles.length > 3 ? '...' : ''}`,
        )
      } else if (pdfFiles.length !== files.length) {
        setUploadError('已忽略非 PDF 文件，只上传 PDF')
      } else {
        setUploadError(null)
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  async function handleRetry(taskId: string) {
    setRetryingTaskId(taskId)
    try {
      const task = await postRetryTask(taskId)
      setTasks((current) => current.map((item) => (item.id === task.id ? task : item)))
    } catch (error) {
      const message = error instanceof Error ? error.message : '重试失败'
      setTasks((current) =>
        current.map((item) => (item.id === taskId ? { ...item, error: message } : item)),
      )
    } finally {
      setRetryingTaskId(null)
    }
  }

  function handleZoteroImported(task: ProcessingTask) {
    setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)])
  }

  function openPaper(task: ProcessingTask) {
    if (task.result?.paperId) {
      window.location.assign(`/reader/${encodeURIComponent(task.result.paperId)}`)
    }
  }

  async function handleSettingsSaved(nextSettings: AppSettings) {
    setSettings(nextSettings)
    try {
      setCapabilities(await fetchCapabilities())
    } catch {
      setCapabilities(null)
    }
  }

  async function handleLibraryUpdate(paper: PaperSummary, payload: UpdatePaperLibraryInput) {
    setUpdatingPaperId(paper.id)
    try {
      const nextPaper = nativeOffline
        ? await updateOfflinePaperSummary(paper.id, payload)
        : await patchPaperLibrary(paper.id, payload)
      updatePaper(nextPaper)
      setBootstrapError(null)
    } catch (error) {
      setBootstrapError(error instanceof Error ? error.message : '文库更新失败')
    } finally {
      setUpdatingPaperId(null)
    }
  }

  function handleTagsEdit(paper: PaperSummary) {
    const currentTags = (paper.tags ?? []).join(', ')
    const value = window.prompt('标签，用空格或逗号分隔', currentTags)
    if (value === null) {
      return
    }
    const tags = value
      .split(/[,\s，、]+/u)
      .map((tag) => tag.trim())
      .filter((tag, index, values) => tag.length > 0 && values.indexOf(tag) === index)
      .slice(0, 12)
    void handleLibraryUpdate(paper, { tags })
  }

  async function handleDeleteImportedPaper(paper: PaperSummary) {
    if (!window.confirm(`确定从这台设备删除《${paper.title}》？本机批注和阅读位置也会一并删除。`)) return
    setUpdatingPaperId(paper.id)
    try {
      await deleteImportedPaper(paper.id)
      await refreshPapers()
    } catch (deleteError) {
      setBootstrapError(deleteError instanceof Error ? deleteError.message : '删除本机文献失败')
    } finally {
      setUpdatingPaperId(null)
    }
  }

  return (
    <main className="cark-page min-h-screen">
      <div className="mx-auto min-h-screen max-w-[1600px] px-6 py-6 lg:px-8">
        <header className={`${nativeApp ? 'mt-24 ' : ''}flex items-center justify-between gap-5`}>
          <div>
            <p className="cark-faint text-xs uppercase tracking-[0.28em]">cark</p>
            <h1 className="cark-title mt-1 font-serif text-3xl">论文库</h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {!nativeApp ? (
              <LibraryTransferActions papers={papers} onImported={refreshPapers} />
            ) : null}
            <ThemeSwitch />
            <button
              type="button"
              onClick={() => nativeApp ? setMobileSettingsOpen(true) : setSettingsOpen(true)}
              className="cark-button-secondary inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm"
            >
              <Settings2 className="h-4 w-4" />
              设置
            </button>
          </div>
        </header>

        {!nativeOffline && capabilities && !capabilities.ready ? (
          <section className="mt-6 flex flex-col justify-between gap-3 rounded-[22px] border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
              <div className="text-sm leading-6 text-amber-100">
                {capabilities.issues.map((issue) => (
                  <p key={issue.code}>{issue.message} {issue.action}</p>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="shrink-0 rounded-full border border-amber-300/25 px-3 py-1.5 text-xs text-amber-100 transition hover:border-amber-300/50"
            >
              打开设置
            </button>
          </section>
        ) : null}

        {!nativeOffline ? (
          <div className={capabilities && !capabilities.ready ? 'mt-4' : 'mt-6'}>
            <UploadPanel
              uploading={uploading}
              disabled={uploadBlocked}
              disabledReason={uploadBlocked ? uploadBlockedReason : null}
              error={uploadError}
              onUpload={(files) => void handleUpload(files)}
              onOpenZotero={() => setZoteroOpen(true)}
            />
          </div>
        ) : null}

        {!nativeOffline && bootstrapError ? (
          <div className="mt-4 rounded-[20px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {bootstrapError}
          </div>
        ) : null}

        <section className={nativeOffline ? 'mt-6 grid min-w-0 gap-6' : 'mt-6 grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_390px]'}>
          <div className="cark-panel min-w-0 rounded-[30px] p-5 lg:p-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="cark-title font-serif text-2xl">所有论文</h2>
                <p className="cark-faint mt-1 text-sm">继续阅读，或找到已经处理过的论文。</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative min-w-[260px]">
                  <Search className="cark-faint pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索论文"
                    className="cark-input w-full rounded-full py-2.5 pl-11 pr-4 text-sm outline-none transition"
                  />
                </div>
                <button
                  type="button"
                  title="刷新论文库"
                  onClick={() => void refreshPapers()}
                  className="cark-button-secondary inline-flex h-10 w-10 items-center justify-center rounded-full"
                >
                  <RefreshCw className={`h-4 w-4 ${papersLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {libraryFilterOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setLibraryFilter(option.value)}
                  className={[
                    'rounded-full px-3 py-1.5 text-xs transition',
                    libraryFilter === option.value ? 'cark-button-accent' : 'cark-button-secondary',
                  ].join(' ')}
                >
                  {option.label}
                </button>
              ))}
              {allTags.length > 0 ? (
                <select
                  value={tagFilter}
                  onChange={(event) => setTagFilter(event.target.value)}
                  aria-label="标签筛选"
                  className="cark-input rounded-full px-3 py-1.5 text-xs outline-none"
                >
                  <option value="all">全部标签</option>
                  {allTags.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

            {!hasQuery && recentPapers.length > 0 ? (
              <section className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="cark-text text-sm font-medium">最近阅读</h3>
                  <span className="cark-faint text-xs">{recentPapers.length}</span>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {recentPapers.map((paper) => (
                    <PaperListItem
                      key={paper.id}
                      paper={paper}
                      recent
                      updating={updatingPaperId === paper.id}
                      onFavoriteToggle={(targetPaper) =>
                        void handleLibraryUpdate(targetPaper, { favorite: !targetPaper.favorite })
                      }
                      onReadingStatusChange={(targetPaper, readingStatus) =>
                        void handleLibraryUpdate(targetPaper, { readingStatus })
                      }
                      onTagsEdit={handleTagsEdit}
                      onDelete={nativeOffline ? (targetPaper) => void handleDeleteImportedPaper(targetPaper) : undefined}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {hasQuery && !nativeOffline ? (
              <section className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="cark-text text-sm font-medium">全文命中</h3>
                  <span className="cark-faint text-xs">{searchLoading ? '搜索中' : searchResults.length}</span>
                </div>
                {searchError ? (
                  <div className="mb-3 rounded-[20px] border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">
                    {searchError}
                  </div>
                ) : null}
                <div className="grid gap-3">
                  {searchResults.slice(0, 12).map((result) => (
                    <Link
                      key={result.id}
                      to={buildSearchResultHref(result)}
                      className="cark-card block rounded-[22px] px-4 py-4 transition hover:border-[rgba(var(--accent-rgb),0.35)] hover:bg-[var(--surface-soft)]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="cark-title line-clamp-1 text-sm">{result.paperTitle}</p>
                        <span className="cark-chip-accent rounded-full px-2.5 py-1 text-[11px]">
                          {result.sourceLabel}
                        </span>
                      </div>
                      <p className="cark-muted mt-2 line-clamp-3 text-sm leading-6">{result.snippet}</p>
                    </Link>
                  ))}
                  {!searchLoading && !searchError && searchResults.length === 0 ? (
                    <div className="cark-faint rounded-[20px] border border-dashed [border-color:var(--border-strong)] px-4 py-5 text-center text-sm">
                      没有正文、批注或记忆命中。
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            <section className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="cark-text text-sm font-medium">{hasQuery ? '搜索结果' : '全部论文'}</h3>
                <span className="cark-faint text-xs">{filteredPapers.length}</span>
              </div>
              {papersError ? (
                <div className="mb-3 rounded-[20px] border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">
                  {papersError}
                </div>
              ) : null}
              <div className="grid gap-3">
                {filteredPapers.map((paper) => (
                  <PaperListItem
                    key={paper.id}
                    paper={paper}
                    updating={updatingPaperId === paper.id}
                    onFavoriteToggle={(targetPaper) =>
                      void handleLibraryUpdate(targetPaper, { favorite: !targetPaper.favorite })
                    }
                    onReadingStatusChange={(targetPaper, readingStatus) =>
                      void handleLibraryUpdate(targetPaper, { readingStatus })
                    }
                    onTagsEdit={handleTagsEdit}
                    onDelete={nativeOffline ? (targetPaper) => void handleDeleteImportedPaper(targetPaper) : undefined}
                  />
                ))}
                {!papersLoading && filteredPapers.length === 0 ? (
                  <div className="cark-faint rounded-[22px] border border-dashed [border-color:var(--border-strong)] px-5 py-8 text-center text-sm">
                    {hasQuery ? '没有匹配的论文。' : nativeOffline ? '还没有论文。请从右上角导入文献包。' : '还没有论文。上传第一篇 PDF。'}
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          {!nativeOffline ? <div className="space-y-6">
            <MemoryInbox
              onChanged={() => {
                void refreshPapers()
                void loadResearchState()
              }}
            />
            <RecentInsights
              items={researchState?.recentInsights ?? []}
              count={researchState?.insightCount ?? 0}
              loading={researchLoading}
              error={researchError}
              onRefresh={() => void loadResearchState()}
            />
            <OpenQuestions
              items={researchState?.openQuestions ?? []}
              count={researchState?.openQuestionCount ?? 0}
              loading={researchLoading}
              error={researchError}
              onRefresh={() => void loadResearchState()}
              onChanged={() => {
                void refreshPapers()
                void loadResearchState()
              }}
            />
            <TaskCenter
              tasks={tasks}
              loading={tasksLoading}
              retryingTaskId={retryingTaskId}
              onRetry={(taskId) => void handleRetry(taskId)}
              onOpenPaper={openPaper}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </div> : null}
        </section>
      </div>

      {!nativeOffline ? <SettingsPanel
        open={settingsOpen}
        settings={settings}
        capabilities={capabilities}
        onClose={() => setSettingsOpen(false)}
        onSaved={(nextSettings) => void handleSettingsSaved(nextSettings)}
      /> : null}
      {!nativeOffline ? <ZoteroImportDialog
        open={zoteroOpen}
        onClose={() => setZoteroOpen(false)}
        onImported={handleZoteroImported}
      /> : null}
      {nativeApp ? <MobileAppSettings
        open={mobileSettingsOpen}
        onClose={() => setMobileSettingsOpen(false)}
        onLibraryChanged={() => void refreshPapers()}
      /> : null}
    </main>
  )
}
