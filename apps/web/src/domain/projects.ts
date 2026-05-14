import { z } from 'zod'
import type { Idea, DraftContext } from './ideas'

export const projectStatusSchema = z.enum(['planning', 'active', 'paused', 'shipped', 'abandoned'])

export const projectSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().min(1),
  createdBy: z.string().min(1),
  title: z.string().trim().min(1).max(180),
  description: z.string().max(10_000).default(''),
  sourceIdeaId: z.string().uuid().nullable().default(null),
  whyNow: z.string().trim().min(1).max(1_000),
  firstStep: z.string().trim().min(1).max(500),
  doneLooksLike: z.string().trim().min(1).max(1_000),
  status: projectStatusSchema.default('planning'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#78716C'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int().positive().default(1),
  clientId: z.string().min(1),
  deviceId: z.string().min(1),
  isDeleted: z.boolean().default(false),
})

export type Project = z.infer<typeof projectSchema>

export interface CreateProjectInput {
  title: string
  description?: string
  whyNow: string
  firstStep: string
  doneLooksLike: string
}

export interface PromoteIdeaInput {
  idea: Idea
  whyNow: string
  firstStep: string
  doneLooksLike: string
}

export function createProjectFromIdea(input: PromoteIdeaInput, context: DraftContext): Project {
  const now = new Date().toISOString()
  return projectSchema.parse({
    id: crypto.randomUUID(),
    workspaceId: context.workspaceId,
    createdBy: context.createdBy,
    title: input.idea.title,
    description: input.idea.body,
    sourceIdeaId: input.idea.id,
    whyNow: input.whyNow,
    firstStep: input.firstStep,
    doneLooksLike: input.doneLooksLike,
    createdAt: now,
    updatedAt: now,
    clientId: context.deviceId,
    deviceId: context.deviceId,
  })
}

export function createProjectDraft(input: CreateProjectInput, context: DraftContext): Project {
  const now = new Date().toISOString()
  return projectSchema.parse({
    id: crypto.randomUUID(),
    workspaceId: context.workspaceId,
    createdBy: context.createdBy,
    title: input.title,
    description: input.description ?? '',
    sourceIdeaId: null,
    whyNow: input.whyNow,
    firstStep: input.firstStep,
    doneLooksLike: input.doneLooksLike,
    createdAt: now,
    updatedAt: now,
    clientId: context.deviceId,
    deviceId: context.deviceId,
  })
}
