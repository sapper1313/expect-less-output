// MCP server for Expect Less Output. A thin wrapper: every tool is one call to the local HTTP API,
// so the same rules apply as for any other agent. It talks MCP over stdio, so nothing may ever be
// written to stdout except protocol messages. Use console.error for logs.
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'
import { ROUTES, type RouteDef } from '../src/shared/agentRoutes'

const API_URL = (process.env.ELO_API_URL || 'http://127.0.0.1:47821').replace(/\/$/, '')
const TOKEN = process.env.ELO_API_TOKEN || ''

/** One flat input object per tool: path ids, query fields and body fields side by side. */
function inputFor(r: RouteDef): z.ZodObject {
  const shape: Record<string, z.ZodType> = {}
  for (const part of [r.params, r.query, r.body]) {
    if (part && 'shape' in part) Object.assign(shape, (part as z.ZodObject).shape)
  }
  return z.object(shape)
}

function describe(r: RouteDef): string {
  const lines = [r.summary]
  if (r.description) lines.push(r.description)
  if (r.schedules)
    lines.push(
      'Safety: the owner may have limited agents to drafts. If so, asking to schedule returns a clear "drafts_only" error. Do not retry it as scheduled.',
    )
  if (r.studioWrite)
    lines.push(
      'Safety: the owner may not have allowed agents to change Studio settings. If so, this returns a clear "studio_locked" error. Do not retry it, tell the owner to turn on "Agents may change Studio settings" in Settings, Agent API.',
    )
  lines.push(
    'Times need a zone, for example 2026-06-02T17:00:00-04:00. Posting times for brands are in Eastern time.',
  )
  return lines.join(' ')
}

async function call(
  r: RouteDef,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; text: string }> {
  if (!TOKEN) {
    return {
      ok: false,
      text: 'ELO_API_TOKEN is not set. Put the token from Expect Less Output (Settings, Agents) in the ELO_API_TOKEN setting of this MCP server.',
    }
  }
  const rest = { ...args }
  let path = r.path
  for (const name of r.params ? Object.keys(r.params.shape) : []) {
    path = path.replace(`{${name}}`, encodeURIComponent(String(rest[name])))
    delete rest[name]
  }
  let url = `${API_URL}${path}`
  let body: string | undefined
  if (r.method === 'GET') {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(rest))
      if (v !== undefined && v !== null) qs.set(k, String(v))
    if ([...qs].length) url += `?${qs}`
  } else {
    body = JSON.stringify(rest)
  }
  let res: Response
  try {
    res = await fetch(url, {
      method: r.method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
    })
  } catch {
    return {
      ok: false,
      text: `Could not reach Expect Less Output at ${API_URL}. Is the app running with the agent API turned on (Settings, Agents)?`,
    }
  }
  const text = await res.text()
  if (res.ok) return { ok: true, text }
  try {
    const e = (
      JSON.parse(text) as { error?: { code?: string; message?: string; details?: unknown } }
    ).error
    return {
      ok: false,
      text: `${e?.code ?? res.status}: ${e?.message ?? text}${e?.details ? ` Details: ${JSON.stringify(e.details)}` : ''}`,
    }
  } catch {
    return { ok: false, text: `HTTP ${res.status}: ${text.slice(0, 300)}` }
  }
}

const server = new McpServer({ name: 'expect-less-output', version: '1.0.0' })

for (const route of ROUTES) {
  if (!route.tool) continue
  server.registerTool(
    route.tool,
    { description: describe(route), inputSchema: inputFor(route) },
    async (args: Record<string, unknown>) => {
      const r = await call(route, args)
      return {
        content: [{ type: 'text' as const, text: r.text }],
        ...(r.ok ? {} : { isError: true }),
      }
    },
  )
}

await server.connect(new StdioServerTransport())
console.error(`Expect Less Output MCP server ready (${API_URL}).`)
