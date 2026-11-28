import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
  },
  renderer: {
    resolve: { alias: { '@shared': shared, '@': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        // Two pages: the app itself, and the read only ELS Ventures page the phone opens.
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          ventures: resolve(__dirname, 'src/renderer/ventures.html'),
        },
      },
    },
  },
})
