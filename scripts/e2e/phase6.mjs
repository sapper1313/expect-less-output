// Phase 6 end to end: the real app with its local API, a watched Inbox, the MCP server, and local AI suggestions.
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { createServer } from 'http'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launch, makeVideos, shot, nav, invoke, sleep } from './lib.mjs'

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a)
const vids = makeVideos(join(tmpdir(), 'elo-vids'), ['p6_a.mp4', 'p6_b.mp4', 'p6_c.mp4'])
const dataDir = mkdtempSync(join(tmpdir(), 'elo-p6-data-'))
const mediaRoot = mkdtempSync(join(tmpdir(), 'elo-p6-media-'))
const port = 47900 + Math.floor(Math.random() * 90)
const { app, page } = await launch({ dataDir, mediaRoot })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await app.evaluate(({ dialog }, files) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [files[2]] })
}, vids)
const base = `http://127.0.0.1:${port}`
const call = async (method, path, { token, body, headers = {} } = {}) => {
  try {
    const r = await fetch(base + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: r.status, json: await r.json().catch(() => null) }
  } catch (e) {
    return { status: 0, error: String(e.cause?.code ?? e.message) }
  }
}
async function waitFor(fn, ms, label) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await sleep(500)
  }
  throw new Error('timeout: ' + label)
}

// 1. Off by default
await invoke(page, 'settings.set', { agentApiPort: port })
log('API off by default: connection result =', JSON.stringify(await call('GET', '/v1/brands')))
await nav(page, 'Settings')
await page.waitForSelector('text=Agents (local API and MCP)')
log(
  'toggle starts unticked:',
  !(await page.getByRole('checkbox', { name: 'Turn on the local API' }).isChecked()),
)

// 2. Turn it on and make a token, through the real screen
await page.getByRole('checkbox', { name: 'Turn on the local API' }).click()
await waitFor(async () => (await invoke(page, 'agent.status')).running, 8000, 'API running')
await page.getByRole('button', { name: 'Make a token' }).click()
await page.waitForSelector('text=Copy this now. It is shown only once.')
const token = (await page.locator('pre').first().textContent()).trim()
await page
  .locator('text=Agents (local API and MCP)')
  .scrollIntoViewIntoViewIfNeeded?.()
  .catch(() => {})
await shot(page, 'p6e-agents-card')
log(
  'token shown once, starts with',
  token.slice(0, 4),
  '| status masks it:',
  (await invoke(page, 'agent.status')).tokenMasked.startsWith('*'),
)
await page.getByRole('button', { name: 'I copied it' }).click()
log(
  'after "I copied it" the token is gone from the screen:',
  (await page.locator('text=Copy this now').count()) === 0,
)

// 3. Authorization and the safety rules
log(
  'no token ->',
  (await call('GET', '/v1/brands')).status,
  '| wrong token ->',
  (await call('GET', '/v1/brands', { token: 'elo_wrong' })).status,
  '| right token ->',
  (await call('GET', '/v1/brands', { token })).status,
)
log(
  'browser Origin header refused ->',
  (await call('GET', '/v1/brands', { token, headers: { Origin: 'https://evil.example' } })).status,
)
const brands = (await call('GET', '/v1/brands', { token })).json.brands
log('brands:', brands.map((b) => b.name).join(' | '))
const sched = await call('POST', '/v1/posts', {
  token,
  body: { brand_id: 1, file_path: vids[0], status: 'scheduled', next_slot: true },
})
log(
  'drafts only: schedule ->',
  sched.status,
  sched.json?.error?.code,
  '|',
  sched.json?.error?.message?.slice(0, 60),
)
const draft = await call('POST', '/v1/posts', {
  token,
  body: { brand_id: 1, file_path: vids[0], title: 'Agent Draft' },
})
log(
  'draft ->',
  draft.status,
  draft.json.status,
  '| original file still there:',
  existsSync(vids[0]),
)
await nav(page, 'Queue')
await page.selectOption('select[aria-label="Status"]', 'all')
await sleep(600)
log('Queue shows the agent draft:', (await page.locator('tr:has-text("Agent Draft")').count()) > 0)
await shot(page, 'p6e-queue-draft')

// 4. Allow scheduling through the screen, then next_slot
await nav(page, 'Settings')
await page.getByRole('checkbox', { name: 'Agents may create drafts only' }).click()
await waitFor(
  async () => (await invoke(page, 'settings.get')).agentMaySchedule === true,
  5000,
  'scheduling allowed',
)
const expected = (await invoke(page, 'slots.next', 1, 1))[0]
const slotPost = await call('POST', '/v1/posts', {
  token,
  body: {
    brand_id: 1,
    file_path: vids[1],
    title: 'Slot Post',
    status: 'scheduled',
    next_slot: true,
  },
})
log(
  'next_slot ->',
  slotPost.status,
  '| lands in the right slot:',
  slotPost.json.scheduled_at === expected,
  slotPost.json.scheduled_at_eastern,
)
await nav(page, 'Calendar')
await sleep(900)
await shot(page, 'p6e-calendar-slot')
log('calendar shows it:', (await page.locator('.fc-event:has-text("Slot Post")').count()) > 0)
const cal = await call('GET', '/v1/calendar?brand_id=1', { token })
log(
  'GET /v1/calendar lists it:',
  cal.json.events.some((e) => e.title === 'Slot Post'),
)

// 5. Watched folder
await nav(page, 'Brands')
await page.getByRole('checkbox', { name: "Watch this brand's Inbox folder" }).click()
await waitFor(
  async () => (await invoke(page, 'settings.get')).inboxBrandIds.includes(1),
  5000,
  'inbox enabled',
)
const inbox = join(mediaRoot, 'Trash Panda', 'Inbox')
await waitFor(async () => existsSync(inbox), 20000, 'inbox folder created')
writeFileSync(join(inbox, 'dropped.mp4'), (await import('fs')).readFileSync(vids[2]))
writeFileSync(
  join(inbox, 'dropped.json'),
  JSON.stringify({
    title: 'From The Inbox',
    caption: 'Dropped in #inbox',
    platforms: ['instagram', 'tiktok'],
    ai_flags: { instagram: true },
  }),
)
await waitFor(
  async () => (await invoke(page, 'posts.list', {})).some((p) => p.title === 'From The Inbox'),
  60000,
  'inbox post',
)
const ip = (await invoke(page, 'posts.list', {})).find((p) => p.title === 'From The Inbox')
log(
  'inbox post:',
  ip.status,
  ip.targets.map((t) => `${t.platform}:${t.aiFlag}`).join(','),
  '|',
  ip.videoPath,
)
log(
  'Inbox is empty afterwards:',
  readdirSync(inbox).filter((f) => f !== 'Rejected').length === 0,
  '| sidecar moved to Queue:',
  existsSync(join(mediaRoot, 'Trash Panda', 'Queue', 'dropped.json')),
)

// 6. MCP server against the running app
const mcpScript = join(process.cwd(), 'mcp/dist/elo-mcp.mjs')
const client = new Client({ name: 'e2e', version: '1' })
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [mcpScript],
    env: { ...process.env, ELO_API_URL: base, ELO_API_TOKEN: token },
    stderr: 'ignore',
  }),
)
const tools = (await client.listTools()).tools.map((t) => t.name)
log('MCP tools:', tools.join(', '))
const lb = JSON.parse(
  (await client.callTool({ name: 'list_brands', arguments: {} })).content[0].text,
)
log('MCP list_brands:', lb.brands.length, 'brands')
const mc = await client.callTool({
  name: 'create_post',
  arguments: { brand_id: 2, file_path: vids[0], title: 'Made Over MCP' },
})
log(
  'MCP create_post draft:',
  JSON.parse(mc.content[0].text).status,
  '| in the app:',
  (await invoke(page, 'posts.list', {})).some((p) => p.title === 'Made Over MCP'),
)
await client.close()

// 7. Local AI suggestions against a fake model
const asked = []
const model = createServer((req, res) => {
  let d = ''
  req.on('data', (c) => (d += c))
  req.on('end', () => {
    asked.push(JSON.parse(d))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                '["Fridge Math, Explained","Why Your Fridge Hums","The Panda Checks The Fridge"]',
            },
          },
        ],
      }),
    )
  })
})
await new Promise((r) => model.listen(0, '127.0.0.1', r))
const mport = model.address().port
await nav(page, 'New Post')
await page.waitForSelector('text=Choose a video')
log(
  'Suggest buttons hidden while text assist is off:',
  (await page.getByRole('button', { name: 'Suggest titles' }).count()) === 0,
)
await invoke(page, 'settings.set', {
  llmProvider: 'openai-compatible',
  llmBaseUrl: `http://127.0.0.1:${mport}/v1`,
  llmModel: 'fake-model',
})
await nav(page, 'Calendar')
await nav(page, 'New Post')
await page.getByRole('button', { name: 'Suggest titles' }).click()
await page.waitForSelector('[role=listbox] >> text=Why Your Fridge Hums')
await shot(page, 'p6e-suggest')
await page.locator('[role=listbox] >> text=Why Your Fridge Hums').click()
log(
  'title after picking a suggestion:',
  await page.locator('input[placeholder="Title"]').inputValue(),
)
log(
  'model was asked with model name',
  asked[0].model,
  '| prompt mentions brand:',
  asked[0].messages[1].content.includes('Trash Panda'),
)
const bad = await invoke(page, 'settings.set', { llmBaseUrl: 'https://api.openai.com/v1' })
const r = await invoke(page, 'textAssist.test').catch((e) => ({
  ok: false,
  message: String(e.message),
}))
log('internet address refused:', r.ok === false, '|', r.message?.slice(0, 70))
model.close()
log('page errors:', JSON.stringify(errors))
await app.close()
