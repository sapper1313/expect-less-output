import { describe, expect, it } from 'vitest'
import { AnthropicClient, billedInputTokens } from '../../src/main/studio/agents/llm'

/** A fake Anthropic that records what it was sent and answers with the usage the test gives it. */
function fake(usage: Record<string, number>) {
  const sent: any[] = []
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body))
    return new Response(
      JSON.stringify({
        content: [{ type: 'tool_use', name: 'submit_answer', input: { ok: true } }],
        stop_reason: 'tool_use',
        usage,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as unknown as typeof fetch
  return { sent, client: new AnthropicClient(() => 'key', fetchImpl) }
}

const base = { agent: 'Show Writer', user: 'go', model: 'claude-sonnet-5-5', maxTokens: 1000 }
const schema = { type: 'object', properties: { ok: { type: 'boolean' } } }

describe('prompt caching', () => {
  it('marks the shared start of the system prompt for caching', async () => {
    const { sent, client } = fake({ input_tokens: 10, output_tokens: 5 })
    await client.complete({
      ...base,
      system: 'BIBLE TEXT\nPart instructions',
      cachePrefix: 'BIBLE TEXT',
      jsonSchema: schema,
    })
    const sys = sent[0].system
    expect(Array.isArray(sys)).toBe(true)
    expect(sys[0]).toEqual({
      type: 'text',
      text: 'BIBLE TEXT',
      cache_control: { type: 'ephemeral' },
    })
    expect(sys[1].text).toContain('Part instructions')
    expect(sys[1].text).toContain('submit_answer')
    expect(sys[1]).not.toHaveProperty('cache_control')
  })

  it('sends a plain string when no prefix is given or the prefix does not match', async () => {
    const { sent, client } = fake({ input_tokens: 10, output_tokens: 5 })
    await client.complete({ ...base, system: 'Just text' })
    await client.complete({ ...base, system: 'Other text', cachePrefix: 'Not the start' })
    expect(sent[0].system).toBe('Just text')
    expect(sent[1].system).toBe('Other text')
  })

  it('counts cache writes and reads at their price so the ledger and caps stay right', async () => {
    expect(billedInputTokens({ input_tokens: 1000, cache_creation_input_tokens: 30000 })).toBe(
      38500,
    )
    expect(billedInputTokens({ input_tokens: 500, cache_read_input_tokens: 30000 })).toBe(3500)
    expect(billedInputTokens({ input_tokens: 700 })).toBe(700)
    expect(billedInputTokens(undefined)).toBe(0)
    const { client } = fake({
      input_tokens: 500,
      cache_read_input_tokens: 30000,
      output_tokens: 90,
    })
    const r = await client.complete({ ...base, system: 'S', cachePrefix: 'S', jsonSchema: schema })
    expect(r.inputTokens).toBe(3500)
    expect(r.outputTokens).toBe(90)
  })
})
