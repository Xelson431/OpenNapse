import { z } from 'zod'

export const ideaResourceKindSchema = z.enum(['markdown', 'link'])

export const ideaResourceSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().min(1),
  ideaId: z.string().uuid(),
  createdBy: z.string().min(1),
  title: z.string().trim().min(1).max(180),
  kind: ideaResourceKindSchema.default('markdown'),
  content: z.string().max(100_000).default(''),
  url: z.string().url().nullable().default(null),
  sortOrder: z.number().default(0),
  version: z.number().int().positive().default(1),
  isDeleted: z.boolean().default(false),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
})

export type IdeaResource = z.infer<typeof ideaResourceSchema>
export type IdeaResourceKind = z.infer<typeof ideaResourceKindSchema>

export interface CreateIdeaResourceInput {
  ideaId: string
  title: string
  kind?: IdeaResourceKind
  content?: string
  url?: string | null
}

export interface UpdateIdeaResourceInput {
  title?: string
  content?: string
  url?: string | null
}

export interface IdeaResourceDraftContext {
  workspaceId: string
  createdBy: string
}

export function createIdeaResourceDraft(input: CreateIdeaResourceInput, context: IdeaResourceDraftContext): IdeaResource {
  const now = new Date().toISOString()
  return ideaResourceSchema.parse({
    id: crypto.randomUUID(),
    workspaceId: context.workspaceId,
    ideaId: input.ideaId,
    createdBy: context.createdBy,
    title: input.title,
    kind: input.kind ?? 'markdown',
    content: input.content ?? '',
    url: input.url ?? null,
    sortOrder: Date.now(),
    createdAt: now,
    updatedAt: now,
  })
}
