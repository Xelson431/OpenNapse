import { z } from 'zod'
import type { Project } from './projects'
import type { DraftContext } from './ideas'

export const taskColumnSchema = z.enum(['backlog', 'todo', 'in_progress', 'review', 'done'])
export const taskPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent'])

export const taskSchema = z.object({
  id: z.string().uuid(),
  logicalId: z.string().uuid().optional(),
  workspaceId: z.string().min(1),
  createdBy: z.string().min(1),
  title: z.string().trim().min(1).max(220),
  description: z.string().max(5_000).default(''),
  projectId: z.string().uuid(),
  ideaId: z.string().uuid().nullable().default(null),
  columnId: taskColumnSchema.default('backlog'),
  sortOrder: z.number().default(0),
  priority: taskPrioritySchema.default('medium'),
  scheduledDate: z.string().date().nullable().default(null),
  dueDate: z.string().date().nullable().default(null),
  completionPct: z.number().int().min(0).max(100).default(0),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).nullable().default(null),
  version: z.number().int().positive().default(1),
  clientId: z.string().min(1),
  deviceId: z.string().min(1),
  isDeleted: z.boolean().default(false),
})

export type Task = z.infer<typeof taskSchema>
export type TaskColumn = z.infer<typeof taskColumnSchema>

export interface CreateTaskInput {
  projectId: string
  title: string
  description?: string
  priority?: z.infer<typeof taskPrioritySchema>
  scheduledDate?: string | null
  dueDate?: string | null
}

export interface UpdateTaskInput {
  scheduledDate?: string | null
  dueDate?: string | null
}

export const taskColumns: Array<{ id: TaskColumn; label: string }> = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'Todo' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
]

export function createFirstStepTask(project: Project): Task {
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  return taskSchema.parse({
    id,
    logicalId: id,
    workspaceId: project.workspaceId,
    createdBy: project.createdBy,
    title: project.firstStep,
    description: `First concrete step for ${project.title}`,
    projectId: project.id,
    ideaId: project.sourceIdeaId,
    columnId: 'backlog',
    sortOrder: Date.now(),
    scheduledDate: null,
    dueDate: null,
    createdAt: now,
    updatedAt: now,
    clientId: project.clientId,
    deviceId: project.deviceId,
  })
}

export function createTaskDraft(input: CreateTaskInput, context: DraftContext): Task {
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  return taskSchema.parse({
    id,
    logicalId: id,
    workspaceId: context.workspaceId,
    createdBy: context.createdBy,
    title: input.title,
    description: input.description ?? '',
    projectId: input.projectId,
    columnId: 'backlog',
    sortOrder: Date.now(),
    priority: input.priority ?? 'medium',
    scheduledDate: input.scheduledDate ?? null,
    dueDate: input.dueDate ?? null,
    createdAt: now,
    updatedAt: now,
    clientId: context.deviceId,
    deviceId: context.deviceId,
  })
}
