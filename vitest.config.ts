import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  // Tests that run ffmpeg can take a few seconds on a busy machine, so the default 5 seconds was too tight.
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30_000 },
})
