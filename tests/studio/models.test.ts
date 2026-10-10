import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_STUDIO_CONFIG } from '../../src/shared/studio/config'
import { llmDollars, isLocalModel } from '../../src/shared/studio/pricing'
import { buildModelOptions, localGuide } from '../../src/shared/studio/modelCatalog'
import { OllamaTextClient, RoutingClient } from '../../src/main/studio/agents/ollamaClient'
import { RetryableError } from '../../src/main/studio/agents/framework'
import { makeStudioEnv } from './helpers'

vi.setConfig({ testTimeout: 60_000 })

describe('per model prices', () => {
  it('prices each Claude model on its own row and local models at zero', () => {
    const c = DEFAULT_STUDIO_CONFIG
    expect(llmDollars(c, 'claude-sonnet-5-5', 1_000_000, 1_000_000)).toBe(18)
    expect(llmDollars(c, 'claude-haiku-5-5', 1_000_000, 1_000_000)).toBe(6)
    expect(llmDollars(c, 'some-new-model', 1_000_000, 0)).toBe(c.prices.anthropicInPerM)
    expect(llmDollars(c, 'ollama:llama3.1:8b', 5_000_000, 5_000_000)).toBe(0)
    expect(isLocalModel('ollama:x')).toBe(true)
  })
  it('describes models in plain words and skips embedding models', () => {
    expect(localGuide('nomic-embed-text')).toBeNull()
    expect(localGuide('llava:13b')?.bestFor).toMatch(/pictures/)
    expect(localGuide('llama3.1:8b')?.bestFor).toMatch(/suggestions/)
    expect(localGuide('qwen2.5:32b')?.avoid).toMatch(/Hollow/)
    const o = buildModelOptions({ 'claude-haiku-5-5': { inPerM: 1, outPerM: 5 } }, { inPerM: 3, outPerM: 15 }, ['llama3.1:8b', 'nomic-embed-text'])
    expect(o.filter((x) => x.kind === 'local').map((x) => x.id)).toEqual(['ollama:llama3.1:8b'])
    expect(o.find((x) => x.id === 'claude-haiku-5-5')?.bestFor).toMatch(/checking/i)
  })
})

describe('local text client', () => {
  const req = { agent: 'Test', system: 's', user: 'u', model: 'ollama:llama3.1:8b', maxTokens: 100, jsonSchema: { type: 'object' } }
  it('sends the schema to Ollama and routes ollama: models there', async () => {
    const seen: unknown[] = []
    const fake = vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ message: { content: '{"a":1}' }, prompt_eval_count: 7, eval_count: 3, done_reason: 'stop' }))
    }) as unknown as typeof fetch
    const cloud = { complete: vi.fn(async () => ({ text: 'cloud', inputTokens: 1, outputTokens: 1 })) }
    const router = new RoutingClient(cloud, new OllamaTextClient(() => 'http://box:11434/', fake))
    const r = await router.complete(req)
    expect(r).toEqual({ text: '{"a":1}', inputTokens: 7, outputTokens: 3 })
    expect((seen[0] as { model: string; format: unknown }).model).toBe('llama3.1:8b')
    expect((seen[0] as { format: unknown }).format).toEqual({ type: 'object' })
    await router.complete({ ...req, model: 'claude-haiku-5-5' })
    expect(cloud.complete).toHaveBeenCalledOnce()
  })
  it('retries a cut-off answer and explains a missing model', async () => {
    const cut = new OllamaTextClient(() => 'http://box', (async () => new Response(JSON.stringify({ message: { content: '{' }, done_reason: 'length' }))) as unknown as typeof fetch)
    await expect(cut.complete({ ...req, model: 'x' })).rejects.toBeInstanceOf(RetryableError)
    const missing = new OllamaTextClient(() => 'http://box', (async () => new Response('no', { status: 404 })) as unknown as typeof fetch)
    await expect(missing.complete({ ...req, model: 'x' })).rejects.toThrow(/does not have the model/)
  })
})

describe('Studio model options', () => {
  it('lists Claude models with prices and saves an edited price', async () => {
    const e = makeStudioEnv()
    const m = await e.studio.modelOptions()
    expect(m.options.some((o) => o.id === 'claude-haiku-5-5')).toBe(true)
    await e.studio.setModelPrice('claude-haiku-5-5', 2, 9)
    const again = await e.studio.modelOptions()
    expect(again.options.find((o) => o.id === 'claude-haiku-5-5')?.inPerM).toBe(2)
    await expect(e.studio.setModelPrice('x', -1, 1)).rejects.toThrow()
  })
})
