import { z } from 'zod'

export const ideaStatusSchema = z.enum(['raw', 'active', 'project', 'done', 'buried'])
export const moodSchema = z.enum(['focused', 'creative', 'anxious', 'energetic', 'tired'])

export const ideaSchema = z.object({
  id: z.string().uuid(),
  logicalId: z.string().uuid().optional(),
  workspaceId: z.string().min(1),
  createdBy: z.string().min(1),
  title: z.string().trim().min(1).max(180),
  body: z.string().max(10_000).default(''),
  description: z.string().max(50_000).default(''),
  status: ideaStatusSchema.default('raw'),
  projectId: z.string().uuid().nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(32)).max(24).default([]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#78716C'),
  energyLevel: z.number().int().min(1).max(5).nullable().default(null),
  mood: moodSchema.nullable().default(null),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  lastTouchedAt: z.string().datetime({ offset: true }),
  buriedAt: z.string().datetime({ offset: true }).nullable().default(null),
  version: z.number().int().positive().default(1),
  clientId: z.string().min(1),
  deviceId: z.string().min(1),
  isDeleted: z.boolean().default(false),
})

export type Idea = z.infer<typeof ideaSchema>
export type IdeaTemperature = 'hot' | 'warm' | 'cool' | 'cold'

export interface CreateIdeaInput {
  title: string
  body?: string
  tags?: string[]
  projectId?: string | null
}

export interface UpdateIdeaInput {
  title?: string
  body?: string
  description?: string
  tags?: string[]
  status?: z.infer<typeof ideaStatusSchema>
}

export interface DraftContext {
  deviceId: string
  workspaceId: string
  createdBy: string
}

export function getIdeaTemperature(lastTouchedAt: string, now = new Date()): IdeaTemperature {
  const ageMs = now.getTime() - new Date(lastTouchedAt).getTime()
  const ageDays = ageMs / 86_400_000

  if (ageDays <= 3) return 'hot'
  if (ageDays <= 7) return 'warm'
  if (ageDays <= 14) return 'cool'
  return 'cold'
}

export function createIdeaDraft(input: CreateIdeaInput, context: DraftContext): Idea {
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  return ideaSchema.parse({
    id,
    logicalId: id,
    workspaceId: context.workspaceId,
    createdBy: context.createdBy,
    title: input.title,
    body: input.body ?? '',
    projectId: input.projectId ?? null,
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    clientId: context.deviceId,
    deviceId: context.deviceId,
  })
}
