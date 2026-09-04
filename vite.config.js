import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const J2AGENT_PROXY_TARGET =
  process.env.VITE_J2AGENT_PROXY_TARGET || 'https://j2agent.jerryt92.top'

export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : './',
  plugins: [vue()],
  css: {
    preprocessorOptions: {
      scss: { api: 'modern-compiler' }
    }
  },
  optimizeDeps: {
    include: ['element-plus', 'mermaid', 'lodash-es', 'markdown-it']
  },
  worker: { format: 'es' },
  server: {
    proxy: {
      '/v1': { target: J2AGENT_PROXY_TARGET, changeOrigin: true, secure: true },
      '/ws': { target: J2AGENT_PROXY_TARGET, changeOrigin: true, ws: true, secure: true }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000
  }
}))
