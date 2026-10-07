// Writes docs/openapi.json from the shared zod schemas. Run: npm run openapi
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'

const root = resolve(new URL('..', import.meta.url).pathname)
const out = join(mkdtempSync(join(tmpdir(), 'elo-openapi-')), 'gen.mjs')
await build({
  entryPoints: [join(root, 'src/shared/openapi.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  alias: { '@shared': join(root, 'src/shared') },
  logLevel: 'error',
})
const { buildOpenApi } = await import(pathToFileURL(out).href)
writeFileSync(join(root, 'docs/openapi.json'), JSON.stringify(buildOpenApi(), null, 2) + '\n')
console.log('wrote docs/openapi.json')
