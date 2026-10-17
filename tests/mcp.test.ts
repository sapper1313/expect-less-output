import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { build } from 'esbuild'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ROUTES } from '../src/shared/agentRoutes'
import { makeAgentEnv } from './agentHelpers'

const root = resolve(__dirname, '..')
let script = ''
const closers: Array<() => Promise<void>> = []

beforeAll(async () => {
  script = join(mkdtempSync(join(tmpdir(), 'elo-mcpbuild-')), 'elo-mcp.mjs')
  await build({
    entryPoints: [join(root, 'mcp/elo-mcp.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: script,
    banner: {
      js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
    },
    alias: { '@shared': join(root, 'src/shared') },
    logLevel: 'error',
  })
}, 60_000)

afterAll(async () => {
  while (closers.length) await closers.pop()!()
})

async function connect(env: Record<string, string>) {
  const client = new Client({ name: 'test', version: '1' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [script],
    env: { ...(process.env as Record<string, string>), ...env },
    stderr: 'ignore',
  })
  await client.connect(transport)
  closers.push(() => client.close())
  return client
}
const text = (r: any): string => r.content.map((c: any) => c.text).join('')

describe('MCP server', () => {
  it('lists exactly the twenty nine tools with descriptions and typed inputs', async () => {
    const a = await makeAgentEnv()
    closers.push(a.close)
    const c = await connect({ ELO_API_URL: a.base, ELO_API_TOKEN: a.token })
    const { tools } = await c.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_bible_skill',
      'add_upcoming',
      'cancel_post',
      'create_drop',
      'create_post',
      'get_brand_stats',
      'get_drop',
      'get_episode',
      'get_health',
      'get_next_open_slots',
      'get_post',
      'get_post_stats',
      'get_reconcile_issues',
      'get_studio_spend',
      'list_bible_skills',
      'list_brands',
      'list_drops',
      'list_episodes',
      'list_flagged_tasks',
      'list_posts',
      'list_upcoming',
      'rebuild_episode',
      'remove_bible_skill',
      'retry_flagged_task',
      'retry_post',
      'set_studio_brand_paused',
      'set_studio_caps',
      'update_post',
      'update_upcoming',
    ])
    expect(tools.map((t) => t.name).sort()).toEqual(
      ROUTES.filter((r) => r.tool)
        .map((r) => r.tool!)
        .sort(),
    )
    const create = tools.find((t) => t.name === 'create_post')!
    expect(create.description).toContain('drafts')
    const props = (create.inputSchema as any).properties
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining([
        'brand_id',
        'file_path',
        'caption_overrides',
        'ai_flags',
        'tiktok',
        'scheduled_at',
        'next_slot',
        'status',
      ]),
    )
    expect((create.inputSchema as any).required).toEqual(
      expect.arrayContaining(['brand_id', 'file_path']),
    )
    expect(props.file_path.description).toContain('Absolute path')
  }, 30_000)

  it('lists brands, creates a draft, reads it, changes it, lists it, and cancels it', async () => {
    const a = await makeAgentEnv()
    closers.push(a.close)
    const c = await connect({ ELO_API_URL: a.base, ELO_API_TOKEN: a.token })

    const brands = JSON.parse(text(await c.callTool({ name: 'list_brands', arguments: {} })))
    expect(brands.brands.map((b: any) => b.name)).toContain('Trash Panda')

    const slots = JSON.parse(
      text(await c.callTool({ name: 'get_next_open_slots', arguments: { brand_id: 1, count: 2 } })),
    )
    expect(slots.slots).toHaveLength(2)

    const created = await c.callTool({
      name: 'create_post',
      arguments: { brand_id: 1, file_path: a.video('mcp_clip.mp4'), title: 'Made By An Agent' },
    })
    expect(created.isError).toBeFalsy()
    const post = JSON.parse(text(created))
    expect(post).toMatchObject({ status: 'draft', title: 'Made By An Agent' })
    expect(a.env.posts.get(post.id)!.title).toBe('Made By An Agent')

    expect(
      JSON.parse(text(await c.callTool({ name: 'get_post', arguments: { id: post.id } }))).id,
    ).toBe(post.id)
    const upd = JSON.parse(
      text(
        await c.callTool({
          name: 'update_post',
          arguments: { id: post.id, caption: 'New words', platforms: ['instagram'] },
        }),
      ),
    )
    expect(upd).toMatchObject({ caption: 'New words' })
    expect(upd.targets.map((t: any) => t.platform)).toEqual(['instagram'])
    expect(
      JSON.parse(text(await c.callTool({ name: 'list_posts', arguments: { brand_id: 1 } }))).posts,
    ).toHaveLength(1)
    expect(
      JSON.parse(text(await c.callTool({ name: 'get_health', arguments: {} }))).agents.drafts_only,
    ).toBe(true)
    expect(
      JSON.parse(text(await c.callTool({ name: 'cancel_post', arguments: { id: post.id } })))
        .status,
    ).toBe('canceled')
  }, 30_000)

  it('shows the drafts_only refusal as an error, not as success', async () => {
    const a = await makeAgentEnv()
    closers.push(a.close)
    const c = await connect({ ELO_API_URL: a.base, ELO_API_TOKEN: a.token })
    const r = await c.callTool({
      name: 'create_post',
      arguments: { brand_id: 1, file_path: a.video(), next_slot: true },
    })
    expect(r.isError).toBe(true)
    expect(text(r)).toContain('drafts_only')
    expect(text(r)).toContain('limited to drafts')
    expect(a.env.posts.list()).toHaveLength(0)
    const retry = await c.callTool({ name: 'retry_post', arguments: { id: 9999 } })
    expect(retry.isError).toBe(true)
    expect(text(retry)).toContain('not_found')
  }, 30_000)

  it('gives clear errors for a missing token, a wrong token and an app that is not running', async () => {
    const a = await makeAgentEnv()
    closers.push(a.close)
    const noToken = await connect({ ELO_API_URL: a.base, ELO_API_TOKEN: '' })
    const r1 = await noToken.callTool({ name: 'list_brands', arguments: {} })
    expect(r1.isError).toBe(true)
    expect(text(r1)).toContain('ELO_API_TOKEN is not set')
    const wrong = await connect({ ELO_API_URL: a.base, ELO_API_TOKEN: 'elo_nope' })
    expect(text(await wrong.callTool({ name: 'list_brands', arguments: {} }))).toContain(
      'unauthorized',
    )
    const off = await connect({ ELO_API_URL: 'http://127.0.0.1:9', ELO_API_TOKEN: 'x' })
    const r3 = await off.callTool({ name: 'list_brands', arguments: {} })
    expect(r3.isError).toBe(true)
    expect(text(r3)).toContain('Is the app running with the agent API turned on')
  }, 30_000)
})
