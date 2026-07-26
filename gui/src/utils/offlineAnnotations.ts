import type {
  AnnotationComment,
  CreateAnnotationCommentInput,
  CreatePaperAnnotationInput,
  PaperAnnotation,
  PaperSummary,
  UpdateAnnotationCommentInput,
  UpdatePaperAnnotationInput,
} from '@/types'
import { PAPER_CACHE_NAME } from '@/utils/offlineLibrary'

function cacheUrl(path: string) {
  return new URL(path, window.location.origin).href
}

function createId(prefix: string) {
  const random = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${random}`
}

function createComment(payload: CreateAnnotationCommentInput): AnnotationComment {
  const now = new Date().toISOString()
  return {
    id: createId('comment'),
    authorType: payload.authorType,
    authorLabel: payload.authorLabel,
    agentId: payload.agentId ?? null,
    replyToCommentId: payload.replyToCommentId ?? null,
    replyToAgentId: payload.replyToAgentId ?? null,
    content: payload.content,
    preview: payload.content.trim().slice(0, 160),
    createdAt: now,
    updatedAt: now,
    status: payload.status ?? 'ready',
  }
}

async function readAnnotations(paperId: string) {
  const cache = await window.caches.open(PAPER_CACHE_NAME)
  const response = await cache.match(cacheUrl(`/api/papers/${encodeURIComponent(paperId)}/annotations`))
  if (!response) return [] as PaperAnnotation[]
  const value = await response.json() as unknown
  return Array.isArray(value) ? value as PaperAnnotation[] : []
}

async function writeAnnotations(paperId: string, annotations: PaperAnnotation[]) {
  const cache = await window.caches.open(PAPER_CACHE_NAME)
  await cache.put(
    cacheUrl(`/api/papers/${encodeURIComponent(paperId)}/annotations`),
    new Response(JSON.stringify(annotations), { headers: { 'Content-Type': 'application/json; charset=utf-8' } }),
  )

  const listUrl = cacheUrl('/api/papers')
  const listResponse = await cache.match(listUrl)
  if (listResponse) {
    const papers = await listResponse.json() as PaperSummary[]
    await cache.put(
      listUrl,
      new Response(JSON.stringify(papers.map((paper) => paper.id === paperId
        ? { ...paper, annotationCount: annotations.filter((annotation) => !annotation.archived).length }
        : paper)), { headers: { 'Content-Type': 'application/json; charset=utf-8' } }),
    )
  }
  return annotations
}

export async function createOfflinePaperAnnotation(paperId: string, payload: CreatePaperAnnotationInput) {
  const annotations = await readAnnotations(paperId)
  const now = new Date().toISOString()
  const annotation: PaperAnnotation = {
    id: createId('annotation'),
    paperId,
    view: payload.view,
    quote: payload.quote,
    contextBefore: payload.contextBefore ?? null,
    contextAfter: payload.contextAfter ?? null,
    blockId: payload.blockId ?? null,
    anchorTop: payload.anchorTop,
    anchorHeight: payload.anchorHeight,
    createdAt: now,
    updatedAt: now,
    archived: false,
    archivedAt: null,
    comments: [createComment(payload.initialComment)],
  }
  return writeAnnotations(paperId, [...annotations, annotation])
}

export async function createOfflineAnnotationComment(
  paperId: string,
  annotationId: string,
  payload: CreateAnnotationCommentInput,
) {
  const annotations = await readAnnotations(paperId)
  return writeAnnotations(paperId, annotations.map((annotation) => annotation.id === annotationId
    ? { ...annotation, updatedAt: new Date().toISOString(), comments: [...annotation.comments, createComment(payload)] }
    : annotation))
}

export async function updateOfflineAnnotationComment(
  paperId: string,
  annotationId: string,
  commentId: string,
  payload: UpdateAnnotationCommentInput,
) {
  const annotations = await readAnnotations(paperId)
  const updatedAt = new Date().toISOString()
  return writeAnnotations(paperId, annotations.map((annotation) => annotation.id === annotationId
    ? {
        ...annotation,
        updatedAt,
        comments: annotation.comments.map((comment) => comment.id === commentId
          ? { ...comment, content: payload.content, preview: payload.content.trim().slice(0, 160), updatedAt }
          : comment),
      }
    : annotation))
}

export async function updateOfflinePaperAnnotation(
  paperId: string,
  annotationId: string,
  payload: UpdatePaperAnnotationInput,
) {
  const annotations = await readAnnotations(paperId)
  const now = new Date().toISOString()
  return writeAnnotations(paperId, annotations.map((annotation) => annotation.id === annotationId
    ? {
        ...annotation,
        ...payload,
        updatedAt: now,
        archivedAt: payload.archived === true ? now : payload.archived === false ? null : annotation.archivedAt,
      }
    : annotation))
}

export async function deleteOfflinePaperAnnotation(paperId: string, annotationId: string) {
  const annotations = await readAnnotations(paperId)
  return writeAnnotations(paperId, annotations.filter((annotation) => annotation.id !== annotationId))
}
