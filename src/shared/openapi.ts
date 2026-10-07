import { z } from 'zod'
import { ROUTES, type RouteDef } from './agentRoutes'
import { ErrorBody } from './agentSchemas'

export const API_VERSION = '1.0.0'

const toSchema = (s: z.ZodType, io: 'input' | 'output') =>
  z.toJSONSchema(s, {
    target: 'openapi-3.0',
    io,
    unrepresentable: 'any',
    reused: 'inline',
  }) as Record<string, any>

function strip(schema: Record<string, any>): Record<string, any> {
  const { $schema: _s, ...rest } = schema
  void _s
  return rest
}

function parameters(r: RouteDef) {
  const out: Array<Record<string, unknown>> = []
  for (const [where, obj] of [
    ['path', r.params],
    ['query', r.query],
  ] as const) {
    if (!obj) continue
    for (const [name, field] of Object.entries(obj.shape as Record<string, z.ZodType>)) {
      const optional = field.safeParse(undefined).success
      out.push({
        name,
        in: where,
        required: where === 'path' ? true : !optional,
        schema: strip(toSchema(field, 'input')),
      })
    }
  }
  return out
}

/** The OpenAPI 3.0 description of the local agent API, built from the same schemas that validate requests. */
export function buildOpenApi(): Record<string, unknown> {
  const errorRef = {
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  }
  const paths: Record<string, Record<string, unknown>> = {}
  for (const r of ROUTES) {
    const op: Record<string, unknown> = {
      operationId: r.id,
      summary: r.summary,
      ...(r.description ? { description: r.description } : {}),
      ...(r.tool ? { 'x-mcp-tool': r.tool } : {}),
      security: [{ bearerAuth: [] }],
    }
    const params = parameters(r)
    if (params.length) op.parameters = params
    if (r.body)
      op.requestBody = {
        required: true,
        content: { 'application/json': { schema: strip(toSchema(r.body, 'input')) } },
      }
    const responses: Record<string, unknown> = {
      [r.success]: {
        description: 'OK',
        content: { 'application/json': { schema: strip(toSchema(r.response, 'output')) } },
      },
      '401': { description: 'Missing or wrong token.', ...errorRef },
      '403': {
        description:
          'Not allowed. For example code drafts_only while agents are limited to drafts.',
        ...errorRef,
      },
    }
    if (r.body || r.query || r.params)
      responses['400'] = { description: 'The request did not match the schema.', ...errorRef }
    if (r.params) responses['404'] = { description: 'No such post.', ...errorRef }
    if (r.id === 'retryPost' || r.id === 'cancelPost' || r.id === 'updatePost')
      responses['409'] = {
        description: 'The post is not in a state where this can be done.',
        ...errorRef,
      }
    op.responses = responses
    ;(paths[r.path] ??= {})[r.method.toLowerCase()] = op
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'Expect Less Output local agent API',
      version: API_VERSION,
      description:
        'Runs inside the Expect Less Output app on 127.0.0.1 only. Off until the owner turns it on in Settings. Send the token as "Authorization: Bearer <token>". Scheduled posts only go out while the app is running. Agents can never connect accounts, change credentials, or delete files.',
    },
    servers: [
      {
        url: 'http://127.0.0.1:47821',
        description: 'Default port. The owner can change it in Settings.',
      },
    ],
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      schemas: { Error: strip(toSchema(ErrorBody, 'output')) },
    },
  }
}
