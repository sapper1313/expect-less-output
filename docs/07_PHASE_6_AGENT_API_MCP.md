# Phase 6: Local Agent API and MCP Server

Goal: let future AI agents (Claude, or a local LLM on the Mac Studio) run the posting operation by calling Expect Less Output directly, with the same rules the UI follows.

## Before you write code

Read `docs/01_PROJECT_SPEC.md`. Fetch the current Model Context Protocol TypeScript SDK docs. Ask questions, then build.

## Build

1. **Local HTTP API**
   - Runs inside the Electron main process, bound to `127.0.0.1` only, port set in Settings (default 47821), off by default with a toggle.
   - Auth: bearer token generated in Settings (show once, regenerate button), stored in the secret store.
   - Every endpoint calls the same service layer the UI uses (no duplicated logic).
   - Endpoints (JSON):
     - `GET /v1/brands` (with slots, defaults, connected platforms)
     - `GET /v1/slots/next-open?brand_id=&count=`
     - `POST /v1/posts` (fields: brand_id, file_path (absolute, copied into Queue), title, caption, platforms, per-platform overrides, ai flags, tiktok settings, scheduled_at or `next_slot: true`, status draft or scheduled)
     - `GET /v1/posts?brand_id=&status=&from=&to=`
     - `GET /v1/posts/{id}`, `PATCH /v1/posts/{id}`, `POST /v1/posts/{id}/cancel`, `POST /v1/posts/{id}/retry`
     - `GET /v1/calendar?brand_id=&from=&to=`
     - `GET /v1/activity?since=`
     - `GET /v1/health` (accounts, modes, quota, scheduler state)
   - OpenAPI spec generated at `docs/openapi.json`.
   - Safety settings: "Agents may create drafts only" (default ON) versus "Agents may schedule". Agents can never connect or disconnect accounts, change credentials, or delete files.

2. **Watched folder (optional ingestion path)**
   - Setting to enable a watch folder per brand: `<Media Root>/<Brand>/Inbox/`.
   - When a video appears with a same-name `.json` sidecar (same fields as `POST /v1/posts`), create the post automatically and move both files into Queue. Without a sidecar, create a Draft using brand defaults.
   - Document the sidecar format with an example in USER_GUIDE.md.

3. **MCP server**
   - Separate small Node script `mcp/elo-mcp.ts` (stdio transport) that wraps the local HTTP API using the bearer token from an environment variable.
   - Tools: `list_brands`, `get_next_open_slots`, `create_post`, `list_posts`, `get_post`, `update_post`, `cancel_post`, `retry_post`, `get_health`.
   - Write exact owner instructions to add it to Claude Desktop and Claude Code (config file location, JSON to paste, where to put the token).

4. **Text assist provider (prep for local LLM)**
   - Add an `openai-compatible` provider for `TextAssistProvider` that targets a configurable local base URL (works with Ollama and LM Studio), model name, off by default. Add "Suggest" buttons next to title, caption, and hashtags that are hidden while the provider is `none`.

## Acceptance checklist

- [ ] API off by default, on by toggle, localhost only, rejects requests without the token.
- [ ] `create_post` via API with `next_slot: true` lands in the correct slot and shows on the calendar.
- [ ] Draft-only safety setting enforced.
- [ ] Watched folder with sidecar creates a correct post.
- [ ] MCP server works from Claude Code (list brands, create a draft).
- [ ] USER_GUIDE.md updated with API, watched folder, MCP, and local LLM setup steps.
- [ ] Committed to git.



## Muse AI Concerns?
Muse will be one of the agents of multiple running automated tasks, so I asked it if these instructions for the build would work, here are it's notes...

- Yeah, this will work. The architecture is the proven pattern — localhost API with bearer auth, MCP server as a thin stdio wrapper over it, everything through the same service layer the UI uses. Nothing exotic, no reason it shouldn't hold together.
Three nits worth fixing before someone builds it:
Draft-only gate needs explicit rejection. The spec says the setting is "enforced" but doesn't say how. If drafts-only is on and an agent sends status: scheduled or next_slot: true, that should come back 403 with a clear error — not silently downgrade to draft. Silent downgrades cause "why didn't my post go out" mysteries.
OpenAPI must be generated from shared schemas, not hand-written. "Generated at docs/openapi.json" — generated from what? If the agent hand-writes it, it drifts from the real routes within a month. Define request/response shapes once (Zod schemas are the natural pick in TS) and generate both validation and the spec from them.
One-line caveat for the guide: scheduled posts only fire while the Electron app is running. Obvious to you, not to whoever reads USER_GUIDE.md later.
The safety boundaries are right — agents never touching credentials or deletes is the correct hard line. And defaulting agents to drafts-only is the right default.
