import { z } from 'zod'
import type { DraftContext } from './ideas'

export const voiceRecordingSchema = z.object({
  id: z.string().uuid(),
  dataUrl: z.string(),
  durationMs: z.number().int().min(0),
  createdAt: z.string().datetime(),
})

export const noteSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().min(1),
  createdBy: z.string().min(1),
  title: z.string().trim().min(1).max(180),
  content: z.string().max(50_000).default(''),
  linkedIdeaId: z.string().uuid().nullable().default(null),
  linkedProjectId: z.string().uuid().nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(32)).max(24).default([]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#78716C'),
  voiceRecordings: z.array(voiceRecordingSchema).max(10).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int().positive().default(1),
  clientId: z.string().min(1),
  deviceId: z.string().min(1),
  isDeleted: z.boolean().default(false),
})

export type Note = z.infer<typeof noteSchema>
export type VoiceRecording = z.infer<typeof voiceRecordingSchema>

export interface UpsertNoteInput {
  id?: string
  title: string
  content: string
  linkedProjectId?: string | null
  linkedIdeaId?: string | null
  voiceRecordings?: VoiceRecording[]
}

export function createNoteDraft(input: UpsertNoteInput, context: DraftContext): Note {
  const now = new Date().toISOString()
  return noteSchema.parse({
    id: input.id ?? crypto.randomUUID(),
    workspaceId: context.workspaceId,
    createdBy: context.createdBy,
    title: input.title,
    content: input.content,
    linkedProjectId: input.linkedProjectId ?? null,
    linkedIdeaId: input.linkedIdeaId ?? null,
    voiceRecordings: input.voiceRecordings ?? [],
    createdAt: now,
    updatedAt: now,
    clientId: context.deviceId,
    deviceId: context.deviceId,
  })
}
