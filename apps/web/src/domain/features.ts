export type FeatureStatus = 'live' | 'foundation' | 'coming-soon'

export interface FeatureDefinition {
  id: string
  label: string
  description: string
  status: FeatureStatus
  securityNote?: string
}

export const features: FeatureDefinition[] = [
  { id: 'ideas', label: 'Ideas', description: 'Raw Brain capture, local cards, entropy labels, and bury/resurrect flow.', status: 'live' },
  { id: 'projects', label: 'Projects', description: 'Promotion flow with Why now, First step, and Done looks like.', status: 'live' },
  { id: 'kanban', label: 'Kanban', description: 'Accessible local board with keyboard-safe task movement.', status: 'live' },
  { id: 'notes', label: 'Notes', description: 'Linked local notes with safe plain-text rendering.', status: 'live', securityNote: 'Rich Tiptap blocks are coming later; current notes avoid raw HTML.' },
  { id: 'graph', label: 'Graph', description: 'Relationship map with accessible list fallback.', status: 'live' },
  { id: 'focus', label: 'Focus', description: 'Daily slots, flow mode foundation, and task completion.', status: 'live' },
  { id: 'stats', label: 'Stats', description: 'Momentum score, idea-to-reality ratio, export, and import.', status: 'live' },
  { id: 'sync', label: 'Cloud Sync', description: 'Supabase backup, auth, conflict recovery, and multi-device bridge.', status: 'coming-soon', securityNote: 'Requires RLS, ownership checks, and safe per-table sync handlers.' },
  { id: 'self-host', label: 'Self-hosting', description: 'Docker Compose, migrations, backups, and secure deployment docs.', status: 'coming-soon', securityNote: 'Requires strong secrets, HTTPS, backups, and service-role key protections.' },
  { id: 'ai', label: 'AI', description: 'Auto-tags, task decomposition, smart links, Daily Spark, and weekly digest.', status: 'coming-soon', securityNote: 'AI is opt-in and local-first; hosted providers require explicit consent.' },
]
