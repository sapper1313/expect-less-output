import { createHash } from 'crypto'
import { z, type ZodType } from 'zod'
import type { Db } from '../../db'
import { isLocalModel, llmDollars } from '@shared/studio/pricing'
import { lintFeedback, lintValue } from '@shared/studio/lint'
import type { StudioConfigService } from '../configService'
import type { SpendService } from '../spend'
import { RetryableError } from './framework'

export interface LlmRequest {
  agent: string
  system: string
  user: string
  maxTokens?: number
  model?: string
  brandId?: number | null
  episodeId?: string | null
  taskId?: number | null
  /** Base64 JPEG frames for vision calls through Claude. */
  images?: string[]
  /** When set, the model must answer by filling this JSON schema (tool use), so the answer is always valid JSON. */
  jsonSchema?: Record<string, unknown>
}

export interface LlmResponse {
  text: string
  inputTokens: number
  outputTokens: number
}

export interface LlmClient {
  complete(req: LlmRequest & { model: string; maxTokens: number }): Promise<LlmResponse>
}

/** Rough token count used for the cap check before a call, and by the mock client. */
export const approxTokens = (s: string) => Math.ceil(s.length / 4)

export class AnthropicClient implements LlmClient {
  constructor(
    private apiKey: () => string | null,
    private fetchImpl: typeof fetch = fetch,
    private base = 'https://api.anthropic.com',
  ) {}

  private headers(): Record<string, string> {
    const key = this.apiKey()
    if (!key)
      throw new Error('The Anthropic API key is not set. Add it in Settings, under the Studio tab.')
    return {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    }
  }

  /** A cheap authenticated call that costs nothing. */
  async test(): Promise<string> {
    const res = await this.fetchImpl(`${this.base}/v1/models?limit=1`, { headers: this.headers() })
    if (!res.ok) throw new Error(await explainHttp('Anthropic', res))
    return 'Connected.'
  }

  async complete(req: LlmRequest & { model: string; maxTokens: number }): Promise<LlmResponse> {
    const content: unknown[] = []
    for (const img of req.images ?? [])
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: img },
      })
    content.push({ type: 'text', text: req.user })
    const send = (withTool: boolean) =>
      this.fetchImpl(`${this.base}/v1/messages`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.maxTokens,
          system: withTool
            ? `${req.system}\n\nGive your answer by calling the submit_answer tool.`
            : req.system,
          messages: [{ role: 'user', content }],
          // Some models only accept "auto", not a forced tool, so the tool is offered and asked for.
          ...(withTool && req.jsonSchema
            ? {
                tools: [
                  {
                    name: 'submit_answer',
                    description: 'Submit the answer in exactly this shape.',
                    input_schema: req.jsonSchema,
                  },
                ],
                tool_choice: { type: 'auto' },
              }
            : {}),
        }),
        signal: AbortSignal.timeout(Math.max(180_000, req.maxTokens * 40)),
      })
    let res = await send(!!req.jsonSchema)
    if (res.status === 400 && req.jsonSchema) {
      // A model that refuses tools altogether answers in plain JSON text instead.
      const t = await res.clone().text()
      if (/tool/i.test(t)) res = await send(false)
    }
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('retry-after'))
      throw new RetryableError(await explainHttp('Anthropic', res), ra > 0 ? ra : undefined)
    }
    if (!res.ok) throw new Error(await explainHttp('Anthropic', res))
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string; input?: unknown }>
      stop_reason?: string
      usage?: { input_tokens?: number; output_tokens?: number }
    }
    const tool = (data.content ?? []).find((c) => c.type === 'tool_use')
    if (req.jsonSchema && data.stop_reason === 'max_tokens')
      throw new RetryableError(
        'The answer was cut off because it was too long. It will be tried again.',
        undefined,
        {
          inputTokens: data.usage?.input_tokens ?? 0,
          outputTokens: data.usage?.output_tokens ?? 0,
        },
      )
    const text = tool
      ? JSON.stringify(tool.input ?? {})
      : (data.content ?? [])
          .filter((c) => c.type === 'text')
          .map((c) => c.text ?? '')
          .join('')
    return {
      text,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    }
  }
}

export async function explainHttp(vendor: string, res: Response): Promise<string> {
  let body = ''
  try {
    body = (await res.text()).slice(0, 300)
  } catch {
    // ignore
  }
  if (res.status === 401 || res.status === 403)
    return `${vendor} refused the key (HTTP ${res.status}). Check the key in Settings, under the Studio tab.`
  if (res.status === 429) return `${vendor} says slow down (HTTP 429).`
  return `${vendor} answered HTTP ${res.status}. ${body}`.trim()
}

type Responder = (req: LlmRequest) => unknown

/** Mock mode text model. Returns canned JSON per agent. Tests register their own responders. */
export class MockLlm implements LlmClient {
  private responders = new Map<string, Responder>()
  calls: LlmRequest[] = []
  /** Number of upcoming calls that should fail (for retry tests). */
  failNext = 0

  respond(agent: string, fn: Responder): void {
    this.responders.set(agent, fn)
  }

  async complete(req: LlmRequest & { model: string; maxTokens: number }): Promise<LlmResponse> {
    this.calls.push(req)
    if (this.failNext > 0) {
      this.failNext--
      throw new RetryableError('Simulated model failure.')
    }
    const fn = this.responders.get(req.agent)
    const out = fn ? fn(req) : { ok: true }
    const text = typeof out === 'string' ? out : JSON.stringify(out)
    return {
      text,
      inputTokens: approxTokens(req.system + req.user),
      outputTokens: approxTokens(text),
    }
  }
}

/** The schema as plain JSON Schema for the model's tool, or undefined when it cannot be made (the text answer is used then). */
export function toJsonSchema(schema: ZodType): Record<string, unknown> | undefined {
  try {
    const j = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<
      string,
      unknown
    >
    delete j.$schema
    return j.type === 'object' ? j : undefined
  } catch {
    return undefined
  }
}

export class LintFailure extends RetryableError {}

export interface GatewayDeps {
  db: Db
  config: StudioConfigService
  spend: SpendService
  /** Returns the mock client in mock mode, the real client otherwise. */
  client: () => LlmClient
  now?: () => number
}

function extractJson(text: string): unknown {
  const t = text.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(t)
  const body = fenced ? fenced[1] : t
  try {
    return JSON.parse(body)
  } catch {
    const a = body.indexOf('{')
    const b = body.lastIndexOf('}')
    if (a >= 0 && b > a) return JSON.parse(body.slice(a, b + 1))
    throw new Error('not json')
  }
}

/**
 * The one door to the text model. Checks caps before the call, writes the ledger and agent_runs,
 * validates JSON against a schema (one retry), and lints the writing (em dashes, robotic phrases).
 */
export class LlmGateway {
  constructor(private d: GatewayDeps) {}

  modelFor(agent: string, override?: string): string {
    const c = this.d.config.get()
    return override || c.agentModels[agent] || c.defaultAgentModel
  }

  /** One raw call with cap check, ledger and run log. */
  async call(req: LlmRequest): Promise<LlmResponse> {
    const cfg = this.d.config.get()
    const mock = cfg.mockMode
    const model = this.modelFor(req.agent, req.model)
    const maxTokens = req.maxTokens ?? 4000
    const estIn = approxTokens(req.system + req.user) + (req.images?.length ?? 0) * 1500
    this.d.spend.check({
      brandId: req.brandId,
      episodeId: req.episodeId,
      vendor: 'anthropic',
      dollars: llmDollars(cfg, model, estIn, maxTokens),
      mock,
    })
    const started = Date.now()
    let res: LlmResponse
    try {
      res = await this.d.client().complete({ ...req, model, maxTokens })
    } catch (e) {
      // A call that was cut off was still billed, so it goes in the ledger.
      const used = e instanceof RetryableError ? e.usage : undefined
      const wasted = used ? llmDollars(cfg, model, used.inputTokens, used.outputTokens) : 0
      if (used && wasted > 0 && !isLocalModel(model))
        this.d.spend.record({
          brandId: req.brandId,
          episodeId: req.episodeId,
          taskId: req.taskId,
          vendor: 'anthropic',
          model,
          units: used.inputTokens + used.outputTokens,
          unitKind: 'tokens',
          unitPrice: 0,
          dollars: wasted,
          purpose: 'text',
          mock,
        })
      this.logRun(
        req,
        model,
        used?.inputTokens ?? 0,
        used?.outputTokens ?? 0,
        wasted,
        started,
        'error',
        mock,
      )
      throw e
    }
    const dollars = llmDollars(cfg, model, res.inputTokens, res.outputTokens)
    if (!isLocalModel(model))
      this.d.spend.record({
        brandId: req.brandId,
        episodeId: req.episodeId,
        taskId: req.taskId,
        vendor: 'anthropic',
        model,
        units: res.inputTokens + res.outputTokens,
        unitKind: 'tokens',
        unitPrice: 0,
        dollars,
        purpose: 'text',
        mock,
      })
    this.logRun(req, model, res.inputTokens, res.outputTokens, dollars, started, 'ok', mock)
    return res
  }

  /** Asks for JSON, validates it, and sends writing back for a rewrite if it fails the lint. */
  async json<T>(req: LlmRequest, schema: ZodType<T>, opts: { lint?: boolean } = {}): Promise<T> {
    const phrases = this.d.config.get().roboticPhrases
    let user = req.user
    let lastProblem = ''
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await this.call({
        ...req,
        user,
        jsonSchema: req.jsonSchema ?? toJsonSchema(schema),
      })
      let value: T
      try {
        const parsed = schema.safeParse(extractJson(res.text))
        if (!parsed.success) throw new Error(parsed.error.message.slice(0, 300))
        value = parsed.data
      } catch (e) {
        lastProblem = (e as Error).message
        if (attempt >= 1 && !lastProblem.startsWith('LINT')) break
        user = `${req.user}\n\nYour last answer was not valid JSON for the required format (${lastProblem}). Answer again with only the JSON.`
        continue
      }
      if (opts.lint !== false) {
        const issues = lintValue(value, phrases)
        if (issues.length) {
          lastProblem = 'LINT ' + issues[0].detail
          user = `${req.user}\n\n${lintFeedback(issues)}`
          continue
        }
      }
      return value
    }
    throw new LintFailure(
      lastProblem.startsWith('LINT')
        ? `The writing still failed the style check after rewrites. ${lastProblem.slice(5)}`
        : `The model did not return usable JSON. ${lastProblem}`,
    )
  }

  private logRun(
    req: LlmRequest,
    model: string,
    inTok: number,
    outTok: number,
    dollars: number,
    started: number,
    outcome: string,
    mock: boolean,
  ) {
    this.d.db
      .prepare(
        `INSERT INTO agent_runs (ts_utc, agent, model, prompt_hash, input_tokens, output_tokens, dollars, duration_ms, outcome, task_id, brand_id, mock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        new Date(this.d.now ? this.d.now() : Date.now()).toISOString(),
        req.agent,
        model,
        createHash('sha1')
          .update(req.system + req.user)
          .digest('hex')
          .slice(0, 12),
        inTok,
        outTok,
        dollars,
        Date.now() - started,
        outcome,
        req.taskId ?? null,
        req.brandId ?? null,
        mock ? 1 : 0,
      )
  }
}
