// Writes docs/sidecar.schema.json and docs/upcoming.schema.json from the shared zod schemas. Run: npm run schemas
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'

const root = resolve(new URL('..', import.meta.url).pathname)
const dir = mkdtempSync(join(tmpdir(), 'elo-schemas-'))
const entry = join(dir, 'entry.ts')
writeFileSync(
  entry,
  `export { buildSidecarSchema } from ${JSON.stringify(join(root, 'src/shared/pipeline.ts'))}\nexport { buildUpcomingSchema } from ${JSON.stringify(join(root, 'src/shared/upcoming.ts'))}\n`,
)
const out = join(dir, 'gen.mjs')
await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  alias: { '@shared': join(root, 'src/shared') },
  nodePaths: [join(root, 'node_modules')],
  logLevel: 'error',
})
const m = await import(pathToFileURL(out).href)
writeFileSync(join(root, 'docs/sidecar.schema.json'), JSON.stringify(m.buildSidecarSchema(), null, 2) + '\n')
writeFileSync(join(root, 'docs/upcoming.schema.json'), JSON.stringify(m.buildUpcomingSchema(), null, 2) + '\n')
console.log('wrote docs/sidecar.schema.json and docs/upcoming.schema.json')
