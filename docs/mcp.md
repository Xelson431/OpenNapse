# OpenNapse MCP Server

`opennapse-mcp` (in `apps/mcp/`) is a [Model Context Protocol](https://modelcontextprotocol.io)
server that lets AI agents read and improve your OpenNapse workspace: list
ideas, see which tasks are in progress or done, read and rewrite idea
descriptions, and manage per-idea markdown resources.

## Why it only works with the cloud backend

OpenNapse is local-first — by default your data lives in the browser's
IndexedDB, which a separate process (the MCP server) cannot read. The MCP
server therefore talks to the **Supabase cloud backend**. You need Supabase
configured and a signed-in account for it to have anything to serve.

## Security model

- The server authenticates **as you** using a Supabase user session (access
  token or email/password). Every query runs through Row Level Security, so an
  agent can only see and edit the workspaces your account can access.
- It never uses the Supabase service-role key. A leaked MCP config cannot
  bypass RLS or reach other users' data.
- It is read/write for ideas and idea resources, and read-only for tasks and
  projects. It cannot delete workspaces, manage billing, or touch other users.

## Configuration

The server reads credentials from environment variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENNAPSE_SUPABASE_URL` | yes | Your Supabase project URL |
| `OPENNAPSE_SUPABASE_ANON_KEY` | yes | Supabase anon (public) key |
| `OPENNAPSE_ACCESS_TOKEN` | one of | A Supabase user access token |
| `OPENNAPSE_REFRESH_TOKEN` | optional | Refresh token paired with the access token |
| `OPENNAPSE_EMAIL` / `OPENNAPSE_PASSWORD` | one of | Email + password sign-in (if you use password auth) |

Provide **either** an access token or an email/password pair.

## Build from source

The package is set up to publish to npm as `opennapse-mcp`, but it is **not
published yet**. Until it is, build it from the monorepo:

```bash
pnpm install
pnpm --filter opennapse-mcp build
```

This produces `apps/mcp/dist/index.js`, an executable stdio server.

## Run with npx (once published)

Once `opennapse-mcp` is published to npm, you'll be able to run it without
cloning or building:

```bash
OPENNAPSE_SUPABASE_URL="https://YOUR_REF.supabase.co" \
OPENNAPSE_SUPABASE_ANON_KEY="your-anon-key" \
OPENNAPSE_ACCESS_TOKEN="your-user-access-token" \
npx opennapse-mcp
```

## Connecting an agent

Most desktop AI tools (Claude Desktop, Cursor, Cline, opencode, etc.) accept an
MCP server defined by a launch command.

Using a local build (works today):

```json
{
  "mcpServers": {
    "opennapse": {
      "command": "node",
      "args": ["/absolute/path/to/OpenNapse/apps/mcp/dist/index.js"],
      "env": {
        "OPENNAPSE_SUPABASE_URL": "https://YOUR_REF.supabase.co",
        "OPENNAPSE_SUPABASE_ANON_KEY": "your-anon-key",
        "OPENNAPSE_ACCESS_TOKEN": "your-user-access-token"
      }
    }
  }
}
```

Once published, swap the command for `"npx"` with `"args": ["-y", "opennapse-mcp"]`.

## Tools

| Tool | Description |
| --- | --- |
| `list_workspaces` | List workspaces the account can access |
| `list_ideas` | List ideas in a workspace, optionally filtered by status |
| `get_idea` | Get a single idea with full body + description |
| `update_idea` | Improve title/body/description/tags/status of an idea |
| `list_projects` | List projects (folders) in a workspace |
| `list_tasks` | List tasks, filterable by column (`backlog`, `todo`, `in_progress`, `review`, `done`) |
| `list_idea_resources` | List markdown docs / links attached to an idea |
| `create_idea_resource` | Attach a markdown doc or link resource to an idea |
| `update_idea_resource` | Update a resource's title, content, or URL |
| `delete_idea_resource` | Delete an idea resource |

## Resources

Each idea is exposed as a readable MCP resource so agents can `@`-reference it:

```
opennapse://{workspaceId}/idea/{ideaId}
```

Reading a resource returns markdown combining the idea's body, its long-form
description, and all attached resources.

## Example agent prompts

- "List the tasks that are in progress in my workspace."
- "Read idea X and write a clearer description for it."
- "Add a markdown resource to idea X with a rough implementation plan."
- "Which ideas are still `raw` and have no description yet?"
