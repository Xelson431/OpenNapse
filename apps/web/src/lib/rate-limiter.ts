export type WriteOperation =
  | 'createIdea'
  | 'updateIdea'
  | 'buryIdea'
  | 'resurrectIdea'
  | 'moveIdeaToProject'
  | 'createIdeaResource'
  | 'updateIdeaResource'
  | 'deleteIdeaResource'
  | 'createProject'
  | 'promoteIdea'
  | 'createTask'
  | 'moveTask'
  | 'updateTask'
  | 'upsertNote'
  | 'deleteNote'
  | 'importData'
  | 'clearAllData'
  | 'workspaceMutation'

type RateLimitConfig = {
  maxRequests: number
  windowMs: number
}

export class RateLimitError extends Error {
  readonly operation: WriteOperation
  readonly retryAfterMs: number

  constructor(operation: WriteOperation, retryAfterMs: number) {
    super(`Too many ${operation} requests. Try again in ${Math.ceil(retryAfterMs / 1000)}s.`)
    this.name = 'RateLimitError'
    this.operation = operation
    this.retryAfterMs = retryAfterMs
  }
}

const LIMITS: Record<WriteOperation, RateLimitConfig> = {
  createIdea: { maxRequests: 30, windowMs: 60_000 },
  updateIdea: { maxRequests: 120, windowMs: 60_000 },
  buryIdea: { maxRequests: 60, windowMs: 60_000 },
  resurrectIdea: { maxRequests: 60, windowMs: 60_000 },
  moveIdeaToProject: { maxRequests: 60, windowMs: 60_000 },
  createIdeaResource: { maxRequests: 60, windowMs: 60_000 },
  updateIdeaResource: { maxRequests: 120, windowMs: 60_000 },
  deleteIdeaResource: { maxRequests: 60, windowMs: 60_000 },
  createProject: { maxRequests: 20, windowMs: 60_000 },
  promoteIdea: { maxRequests: 20, windowMs: 60_000 },
  createTask: { maxRequests: 30, windowMs: 60_000 },
  moveTask: { maxRequests: 120, windowMs: 60_000 },
  updateTask: { maxRequests: 120, windowMs: 60_000 },
  upsertNote: { maxRequests: 20, windowMs: 60_000 },
  deleteNote: { maxRequests: 20, windowMs: 60_000 },
  importData: { maxRequests: 5, windowMs: 600_000 },
  clearAllData: { maxRequests: 3, windowMs: 600_000 },
  workspaceMutation: { maxRequests: 20, windowMs: 60_000 },
}

const hits = new Map<WriteOperation, number[]>()

export function assertWriteAllowed(operation: WriteOperation): void {
  const limit = LIMITS[operation]
  const now = Date.now()
  const windowStart = now - limit.windowMs
  const recent = (hits.get(operation) ?? []).filter((timestamp) => timestamp > windowStart)
  if (recent.length >= limit.maxRequests) {
    throw new RateLimitError(operation, Math.max(recent[0]! + limit.windowMs - now, 0))
  }
  recent.push(now)
  hits.set(operation, recent)
}

export function resetWriteRateLimits(): void {
  hits.clear()
}
