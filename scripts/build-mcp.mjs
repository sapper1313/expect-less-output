// Bundles mcp/elo-mcp.ts and everything it needs into one file: mcp/dist/elo-mcp.mjs. Run: npm run build:mcp
import { build } from 'esbuild'
import { resolve, join } from 'path'

const root = resolve(new URL('..', import.meta.url).pathname)
await build({
  entryPoints: [join(root, 'mcp/elo-mcp.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: join(root, 'mcp/dist/elo-mcp.mjs'),
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
  alias: { '@shared': join(root, 'src/shared') },
  logLevel: 'warning',
})
console.log('built mcp/dist/elo-mcp.mjs')
