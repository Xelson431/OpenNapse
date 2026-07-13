#!/usr/bin/env node
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { loadConfig, createUserClient } from './config.js'
import { OpenNapseData } from './data.js'

function jsonContent(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

function errorContent(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

async function main() {
  const config = loadConfig()
  const { client, userId } = await createUserClient(config)
  const data = new OpenNapseData(client)

  const server = new McpServer({ name: 'opennapse', version: '0.1.0' })

  // --- Tools -------------------------------------------------------------

  server.registerTool(
    'list_workspaces',
    {
      title: 'List workspaces',
      description: 'List the workspaces the authenticated user can access.',
      inputSchema: {},
    },
    async () => {
      try {
        return jsonContent(await data.listWorkspaces())
      } catch (err) {
        return errorContent(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'list_ideas',
    {
      title: 'List ideas',
      description: 'List ideas in a workspace, optionally filtered by status (raw, active, project, done, buried).',
      inputSchema: {
        workspaceId: z.string().describe('Workspace UUID from list_workspaces'),
        status: z.enum(['raw', 'active', 'project', 'done', 'buried']).optional(),
      },
    },
    async ({ workspaceId, status }) => {
      try {
        return jsonContent(await data.listIdeas(workspaceId, status))
      } catch (err) {
        return errorContent(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'get_idea',
    {
      title: 'Get idea',
      description: 'Get a single idea with its full body and description.',
      inputSchema: { workspaceId: z.string(), ideaId: z.string() },
    },
    async ({ workspaceId, ideaId }) => {
      try {
        const idea = await data.getIdea(workspaceId, ideaId)
        return idea ? jsonContent(idea) : errorContent('Idea not found.')
      } catch (err) {
        return errorContent(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'update_idea',
    {
      title: 'Update idea',
      description: 'Update an idea. Use this to improve titles, add or rewrite the markdown description, adjust tags, or change status.',
      inputSchema: {
        workspaceId: z.string(),
        ideaId: z.string(),
        title: z.string().max(180).optional(),
        body: z.string().max(10_000).optional(),
        description: z.string().max(50_000).optional().describe('Long-form markdown description of the idea'),
        status: z.enum(['raw', 'active', 'project', 'done', 'buried']).optional(),
        tags: z.array(z.string()).max(24).optional(),
      },
    },
    async ({ workspaceId, ideaId, ...patch }) => {
      try {
        return jsonContent(await data.updateIdea(workspaceId, ideaId, patch))
      } catch (err) {
        return errorContent(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: 'List projects (folders) in a workspace.',
      inputSchema: { workspaceId: z.string() },
    },
    async ({ workspaceId }) => {
      try {
        return jsonContent(await data.listProjects(workspaceId))
      } catch (err) {
        return errorContent(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description: 'List tasks in a workspace. Filter by column to see what is in progress, done, etc. Columns: backlog, todo, in_progress, review, done.',
      inputSchema: {
        workspaceId: z.string(),
        column: z.enum(['backlog', 'todo', 'in_progress', 'review', 'done']).optional(),
      },
    },
    async ({ workspaceId, column }) => {
      try {
        return jsonContent(await data.listTasks(workspaceId, column))
      } catch (err) {
        return errorContent(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'list_idea_resources',
    {
      title: 'List idea resources',
      description: 'List markdown docs / links attached to an idea.',
      inputSchema: { workspaceId: z.string(), ideaId: z.string() },
    },
    async ({ workspaceId, ideaId }) => {
      try {
        return jsonContent(await data.listIdeaResources(workspaceId, ideaId))
      } catch (err) {
        return errorContent(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'create_idea_resource',
    {
      title: 'Create idea resource',
      description: 'Attach a markdown doc or link resource to an idea.',
      inputSchema: {
        workspaceId: z.string(),
        ideaId: z.string(),
        title: z.string().max(180),
        kind: z.enum(['markdown', 'link']).optional(),
        content: z.string().max(100_000).optional(),
        url: z.string().url().nullable().optional(),
      },
    },
    async ({ workspaceId, ideaId, title, kind, content, url }) => {
      try {
        return jsonContent(await data.createIdeaResource(workspaceId, userId, { ideaId, title, kind, content, url }))
      } catch (err) {
        return errorContent(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'update_idea_resource',
    {
      title: 'Update idea resource',
      description: 'Update the title, markdown content, or URL of an idea resource.',
      inputSchema: {
        workspaceId: z.string(),
        resourceId: z.string(),
        title: z.string().max(180).optional(),
        content: z.string().max(100_000).optional(),
        url: z.string().url().nullable().optional(),
      },
    },
    async ({ workspaceId, resourceId, ...patch }) => {
      try {
        return jsonContent(await data.updateIdeaResource(workspaceId, resourceId, patch))
      } catch (err) {
        return errorContent(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'delete_idea_resource',
    {
      title: 'Delete idea resource',
      description: 'Delete an idea resource.',
      inputSchema: { workspaceId: z.string(), resourceId: z.string() },
    },
    async ({ workspaceId, resourceId }) => {
      try {
        await data.deleteIdeaResource(workspaceId, resourceId)
        return jsonContent({ ok: true })
      } catch (err) {
        return errorContent(err instanceof Error ? err.message : String(err))
      }
    },
  )

  // --- Resources ---------------------------------------------------------
  // Each idea is exposed as a readable MCP resource so agents can @-reference
  // it. URI form: opennapse://{workspaceId}/idea/{ideaId}
  server.registerResource(
    'idea',
    new ResourceTemplate('opennapse://{workspaceId}/idea/{ideaId}', {
      list: async () => {
        const workspaces = await data.listWorkspaces()
        const entries: { uri: string; name: string }[] = []
        for (const workspace of workspaces) {
          const ideas = await data.listIdeas(workspace.id)
          for (const idea of ideas) {
            entries.push({
              uri: `opennapse://${workspace.id}/idea/${idea.id as string}`,
              name: `${workspace.name}: ${idea.title as string}`,
            })
          }
        }
        return { resources: entries }
      },
    }),
    { title: 'OpenNapse idea', description: 'An idea with its description and attached resources', mimeType: 'text/markdown' },
    async (uri, variables) => {
      const workspaceId = String(variables.workspaceId)
      const ideaId = String(variables.ideaId)
      const idea = await data.getIdea(workspaceId, ideaId)
      if (!idea) throw new Error('Idea not found')
      const resources = await data.listIdeaResources(workspaceId, ideaId)
      const body = String(idea.body ?? '')
      const description = String(idea.description ?? '')
      const resourceBlocks = resources
        .map((r) => `### ${r.title}\n\n${r.kind === 'link' ? (r.url ?? '') : (r.content ?? '')}`)
        .join('\n\n')
      const markdown = [
        `# ${idea.title as string}`,
        body ? `\n${body}` : '',
        description ? `\n## Description\n\n${description}` : '',
        resources.length ? `\n## Resources\n\n${resourceBlocks}` : '',
      ].join('\n')
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: markdown }] }
    },
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('OpenNapse MCP server running on stdio')
}

main().catch((error) => {
  console.error('Fatal error in OpenNapse MCP server:', error)
  process.exit(1)
})
