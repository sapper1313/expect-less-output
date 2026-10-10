import { LOCAL_MODEL_PREFIX } from '@shared/studio/pricing'
import { RetryableError } from './framework'
import type { LlmClient, LlmRequest, LlmResponse } from './llm'

/**
 * Text and JSON answers from a model on the owner's own Ollama machine. Free. When the call carries a
 * JSON schema, Ollama is asked to answer in exactly that shape, so small models still give valid JSON.
 */
export class OllamaTextClient implements LlmClient {
  constructor(
    private host: () => string,
    private fetchImpl: typeof fetch = fetch,
    private timeoutMs = 10 * 60_000,
  ) {}

  async complete(req: LlmRequest & { model: string; maxTokens: number }): Promise<LlmResponse> {
    const host = this.host().replace(/\/+$/, '')
    if (!host) throw new Error('The Ollama host is empty. Set it on the Local AI section in Settings, under AI models and Local AI.')
    let res: Response
    try {
      res = await this.fetchImpl(`${host}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          model: req.model,
          stream: false,
          ...(req.jsonSchema ? { format: req.jsonSchema } : {}),
          options: { num_predict: req.maxTokens, temperature: 0.5 },
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user, ...(req.images?.length ? { images: req.images } : {}) },
          ],
        }),
      })
    } catch (e) {
      throw new RetryableError(`Could not reach Ollama at ${host}: ${(e as Error).message}`)
    }
    if (!res.ok) {
      const t = (await res.text().catch(() => '')).slice(0, 200)
      if (res.status === 404) throw new Error(`Ollama does not have the model "${req.model}". Download it on the Local AI section in Settings, under AI models and Local AI. ${t}`)
      throw new RetryableError(`Ollama answered HTTP ${res.status}. ${t}`)
    }
    const data = (await res.json()) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number; done_reason?: string }
    if (req.jsonSchema && data.done_reason === 'length')
      throw new RetryableError('The answer was cut off because it was too long. It will be tried again.')
    return { text: data.message?.content ?? '', inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 }
  }
}

/** Sends `ollama:name` models to the owner's machine and every other model to Claude. */
export class RoutingClient implements LlmClient {
  constructor(
    private cloud: LlmClient,
    private local: LlmClient,
  ) {}
  complete(req: LlmRequest & { model: string; maxTokens: number }): Promise<LlmResponse> {
    return req.model.startsWith(LOCAL_MODEL_PREFIX)
      ? this.local.complete({ ...req, model: req.model.slice(LOCAL_MODEL_PREFIX.length) })
      : this.cloud.complete(req)
  }
}
