import { createServer } from 'http'
import { describe, expect, it } from 'vitest'
import {
  OpenAICompatibleProvider,
  checkLlmUrl,
  parseSuggestions,
} from '../src/main/services/textAssist'

describe('model address safety', () => {
  it('allows only this Mac by default', () => {
    expect(checkLlmUrl('http://localhost:11434/v1', false)).toEqual({
      ok: true,
      url: 'http://localhost:11434/v1',
    })
    expect(checkLlmUrl('http://127.0.0.1:1234/v1/', false)).toEqual({
      ok: true,
      url: 'http://127.0.0.1:1234/v1',
    })
    expect(checkLlmUrl('http://[::1]:1234/v1', false).ok).toBe(true)
  })

  it('allows a computer on the local network only when the box is ticked', () => {
    for (const u of [
      'http://192.168.1.50:11434/v1',
      'http://10.0.0.4:1234/v1',
      'http://172.20.1.1/v1',
      'http://mac-studio.local:11434/v1',
    ]) {
      const off = checkLlmUrl(u, false)
      expect(off.ok).toBe(false)
      expect(!off.ok && off.message).toContain('another computer')
      expect(checkLlmUrl(u, true).ok).toBe(true)
    }
  })

  it('never allows the internet, even with the box ticked, and rejects nonsense', () => {
    for (const u of [
      'https://api.openai.com/v1',
      'http://8.8.8.8/v1',
      'http://example.com:11434/v1',
      'http://192.168.1.1.evil.com/v1',
    ]) {
      const r = checkLlmUrl(u, true)
      expect(r.ok).toBe(false)
      expect(!r.ok && r.message).toContain('never sent over the internet')
    }
    expect(checkLlmUrl('not a url', true).ok).toBe(false)
    expect(checkLlmUrl('ftp://localhost/v1', true).ok).toBe(false)
  })
})

describe('reading what the model says', () => {
  it('accepts a JSON array, an array wrapped in chatter, or one idea per line', () => {
    expect(parseSuggestions('["A","B","C"]')).toEqual(['A', 'B', 'C'])
    expect(parseSuggestions('Sure! Here you go:\n["One", "Two"]\nHope that helps')).toEqual([
      'One',
      'Two',
    ])
    expect(parseSuggestions('1. First idea\n2) Second idea\n- Third idea\n')).toEqual([
      'First idea',
      'Second idea',
      'Third idea',
    ])
    expect(parseSuggestions('```json\n["x"]\n```')).toEqual(['x'])
    expect(parseSuggestions('')).toEqual([])
  })
})

describe('OpenAI-compatible provider', () => {
  async function fakeModel(
    handler: (body: any) => { status?: number; content?: string; delayMs?: number },
  ) {
    const seen: any[] = []
    const server = createServer((req, res) => {
      let data = ''
      req.on('data', (c) => (data += c))
      req.on('end', () => {
        const body = data ? JSON.parse(data) : {}
        seen.push({ url: req.url, auth: req.headers.authorization, body })
        const r = handler(body)
        setTimeout(() => {
          res.writeHead(r.status ?? 200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify(
              r.status && r.status >= 400
                ? { error: 'x' }
                : { choices: [{ message: { content: r.content } }] },
            ),
          )
        }, r.delayMs ?? 0)
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    return {
      seen,
      base: `http://127.0.0.1:${port}/v1`,
      close: () =>
        new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))),
    }
  }

  it('asks for titles, captions and hashtags and sends only the brand, title and caption', async () => {
    const m = await fakeModel((b) => ({
      content: JSON.stringify([`ok ${b.messages[1].content.split('\n').length}`]),
    }))
    const p = new OpenAICompatibleProvider({ baseUrl: m.base, model: 'llama3' })
    const input = { brand: 'Trash Panda', title: 'Fridge Math', caption: 'Do the math' }
    expect((await p.suggestTitle(input)).length).toBe(1)
    await p.suggestCaption(input)
    await p.suggestHashtags(input)
    expect(m.seen.map((s) => s.url)).toEqual([
      '/v1/chat/completions',
      '/v1/chat/completions',
      '/v1/chat/completions',
    ])
    expect(m.seen[0].body.model).toBe('llama3')
    expect(m.seen[0].auth).toBeUndefined() // no key is sent
    const prompt = m.seen.map((s) => s.body.messages[1].content).join('\n')
    expect(prompt).toContain('Trash Panda')
    expect(prompt).toContain('Fridge Math')
    expect(prompt).not.toMatch(/token|secret|\/Users\//i)
    await m.close()
  })

  it('explains the usual problems in plain words', async () => {
    const down = new OpenAICompatibleProvider({ baseUrl: 'http://127.0.0.1:9/v1', model: 'm' })
    await expect(down.suggestTitle({ brand: 'b', title: '', caption: '' })).rejects.toThrow(
      /Is Ollama or LM Studio running/,
    )
    const missing = await fakeModel(() => ({ status: 404 }))
    await expect(
      new OpenAICompatibleProvider({ baseUrl: missing.base, model: 'nope' }).suggestTitle({
        brand: 'b',
        title: '',
        caption: '',
      }),
    ).rejects.toThrow(/Check the model name "nope"/)
    await missing.close()
    const slow = await fakeModel(() => ({ content: '["x"]', delayMs: 400 }))
    await expect(
      new OpenAICompatibleProvider({ baseUrl: slow.base, model: 'm', timeoutMs: 100 }).suggestTitle(
        { brand: 'b', title: '', caption: '' },
      ),
    ).rejects.toThrow(/took too long/)
    await slow.close()
    const empty = await fakeModel(() => ({ content: '' }))
    await expect(
      new OpenAICompatibleProvider({ baseUrl: empty.base, model: 'm' }).suggestTitle({
        brand: 'b',
        title: '',
        caption: '',
      }),
    ).rejects.toThrow(/sent back nothing/)
    await empty.close()
  })
})
