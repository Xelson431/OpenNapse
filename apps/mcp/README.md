# opennapse-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for
[OpenNapse](https://github.com/Xelson431/OpenNapse). It lets AI agents read and
improve your OpenNapse workspace: list ideas, see which tasks are in progress
or done, read and rewrite idea descriptions, and manage per-idea markdown
resources.

It authenticates **as you** through Supabase Row Level Security and never uses
a service-role key, so an agent only ever sees the workspaces your account can
access.

> OpenNapse is local-first. This server talks to the **Supabase cloud
> backend**, so you need Supabase configured and a signed-in account.

## Run with npx

```bash
OPENNAPSE_SUPABASE_URL="https://YOUR_REF.supabase.co" \
OPENNAPSE_SUPABASE_ANON_KEY="your-anon-key" \
OPENNAPSE_ACCESS_TOKEN="your-user-access-token" \
npx opennapse-mcp
```

## Agent config

Most desktop AI tools (Claude Desktop, Cursor, Cline, opencode, …) accept an
MCP server defined by a launch command:

```json
{
  "mcpServers": {
    "opennapse": {
      "command": "npx",
      "args": ["-y", "opennapse-mcp"],
      "env": {
        "OPENNAPSE_SUPABASE_URL": "https://YOUR_REF.supabase.co",
        "OPENNAPSE_SUPABASE_ANON_KEY": "your-anon-key",
        "OPENNAPSE_ACCESS_TOKEN": "your-user-access-token"
      }
    }
  }
}
```

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENNAPSE_SUPABASE_URL` | yes | Your Supabase project URL |
| `OPENNAPSE_SUPABASE_ANON_KEY` | yes | Supabase anon (public) key |
| `OPENNAPSE_ACCESS_TOKEN` | one of | A Supabase user access token |
| `OPENNAPSE_REFRESH_TOKEN` | optional | Refresh token paired with the access token |
| `OPENNAPSE_EMAIL` / `OPENNAPSE_PASSWORD` | one of | Email + password sign-in |

Provide **either** an access token or an email/password pair.

## Tools

`list_workspaces`, `list_ideas`, `get_idea`, `update_idea`, `list_projects`,
`list_tasks`, `list_idea_resources`, `create_idea_resource`,
`update_idea_resource`, `delete_idea_resource`.

Each idea is also exposed as a readable resource at
`opennapse://{workspaceId}/idea/{ideaId}`.

Full docs: [docs/mcp.md](https://github.com/Xelson431/OpenNapse/blob/main/docs/mcp.md).
