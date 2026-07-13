import type { SupabaseClient } from '@supabase/supabase-js'

export type WorkspaceRow = { id: string; name: string; type: string }

export class OpenNapseData {
  constructor(private readonly client: SupabaseClient) {}

  async listWorkspaces(): Promise<WorkspaceRow[]> {
    const { data, error } = await this.client
      .from('workspaces')
      .select('id, name, type')
      .order('created_at', { ascending: true })
    if (error) throw new Error(`listWorkspaces: ${error.message}`)
    return (data ?? []) as WorkspaceRow[]
  }

  async listIdeas(workspaceId: string, status?: string): Promise<Record<string, unknown>[]> {
    let query = this.client
      .from('ideas')
      .select('id, title, body, description, status, tags, project_id, energy_level, mood, last_touched_at, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('is_deleted', false)
      .order('updated_at', { ascending: false })
    if (status) query = query.eq('status', status)
    const { data, error } = await query
    if (error) throw new Error(`listIdeas: ${error.message}`)
    return (data ?? []) as Record<string, unknown>[]
  }

  async getIdea(workspaceId: string, ideaId: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await this.client
      .from('ideas')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', ideaId)
      .maybeSingle()
    if (error) throw new Error(`getIdea: ${error.message}`)
    return (data as Record<string, unknown> | null) ?? null
  }

  async updateIdea(
    workspaceId: string,
    ideaId: string,
    patch: { title?: string; body?: string; description?: string; status?: string; tags?: string[] },
  ): Promise<Record<string, unknown>> {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString(), last_touched_at: new Date().toISOString() }
    if (patch.title !== undefined) update.title = patch.title
    if (patch.body !== undefined) update.body = patch.body
    if (patch.description !== undefined) update.description = patch.description
    if (patch.status !== undefined) update.status = patch.status
    if (patch.tags !== undefined) update.tags = patch.tags
    const { data, error } = await this.client
      .from('ideas')
      .update(update)
      .eq('workspace_id', workspaceId)
      .eq('id', ideaId)
      .select('*')
      .single()
    if (error || !data) throw new Error(`updateIdea: ${error?.message ?? 'no row'}`)
    return data as Record<string, unknown>
  }

  async listProjects(workspaceId: string): Promise<Record<string, unknown>[]> {
    const { data, error } = await this.client
      .from('projects')
      .select('id, title, description, status, why_now, first_step, done_looks_like, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('is_deleted', false)
      .order('updated_at', { ascending: false })
    if (error) throw new Error(`listProjects: ${error.message}`)
    return (data ?? []) as Record<string, unknown>[]
  }

  async listTasks(workspaceId: string, columnId?: string): Promise<Record<string, unknown>[]> {
    let query = this.client
      .from('tasks')
      .select('id, title, description, column_id, priority, project_id, completion_pct, scheduled_date, due_date, completed_at, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('is_deleted', false)
      .order('sort_order', { ascending: true })
    if (columnId) query = query.eq('column_id', columnId)
    const { data, error } = await query
    if (error) throw new Error(`listTasks: ${error.message}`)
    return (data ?? []) as Record<string, unknown>[]
  }

  async listIdeaResources(workspaceId: string, ideaId: string): Promise<Record<string, unknown>[]> {
    const { data, error } = await this.client
      .from('idea_resources')
      .select('id, idea_id, title, kind, content, url, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('idea_id', ideaId)
      .eq('is_deleted', false)
      .order('sort_order', { ascending: true })
    if (error) throw new Error(`listIdeaResources: ${error.message}`)
    return (data ?? []) as Record<string, unknown>[]
  }

  async createIdeaResource(
    workspaceId: string,
    userId: string,
    input: { ideaId: string; title: string; kind?: 'markdown' | 'link'; content?: string; url?: string | null },
  ): Promise<Record<string, unknown>> {
    const row = {
      workspace_id: workspaceId,
      idea_id: input.ideaId,
      created_by: userId,
      title: input.title,
      kind: input.kind ?? 'markdown',
      content: input.content ?? '',
      url: input.url ?? null,
      sort_order: Date.now(),
    }
    const { data, error } = await this.client.from('idea_resources').insert(row).select('*').single()
    if (error || !data) throw new Error(`createIdeaResource: ${error?.message ?? 'no row'}`)
    return data as Record<string, unknown>
  }

  async updateIdeaResource(
    workspaceId: string,
    resourceId: string,
    patch: { title?: string; content?: string; url?: string | null },
  ): Promise<Record<string, unknown>> {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (patch.title !== undefined) update.title = patch.title
    if (patch.content !== undefined) update.content = patch.content
    if (patch.url !== undefined) update.url = patch.url
    const { data, error } = await this.client
      .from('idea_resources')
      .update(update)
      .eq('workspace_id', workspaceId)
      .eq('id', resourceId)
      .select('*')
      .single()
    if (error || !data) throw new Error(`updateIdeaResource: ${error?.message ?? 'no row'}`)
    return data as Record<string, unknown>
  }

  async deleteIdeaResource(workspaceId: string, resourceId: string): Promise<void> {
    const { error } = await this.client
      .from('idea_resources')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', resourceId)
    if (error) throw new Error(`deleteIdeaResource: ${error.message}`)
  }
}
