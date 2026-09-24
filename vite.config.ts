import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { bundledLanguagesInfo } from 'shiki/langs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

const shikiSupportedLangs = bundledLanguagesInfo.flatMap(info => [info.id, ...(info.aliases ?? [])])

function katexWoff2Only() {
  return {
    name: 'katex-woff2-only',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const normalizedId = id.split('?')[0].replace(/\\/g, '/')
      if (!normalizedId.endsWith('/katex/dist/katex.min.css') && !normalizedId.endsWith('/katex/dist/katex.css')) {
        return null
      }

      return code.replace(
        /,url\(fonts\/KaTeX_[^)]+\.woff\) format\("woff"\),url\(fonts\/KaTeX_[^)]+\.ttf\) format\("truetype"\)/g,
        '',
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __SHIKI_SUPPORTED_LANGS__: JSON.stringify(shikiSupportedLangs),
  },
  plugins: [katexWoff2Only(), react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return

          if (id.includes('@xterm/')) return 'vendor-terminal'
          // CodeMirror 被 ContentBlock 懒加载，单独成 chunk 便于长期缓存；
          // 缺少这条规则时它会落进主 chunk，把首屏体积抬高约 25%。
          if (id.includes('@codemirror/') || id.includes('@lezer/')) return 'vendor-codemirror'
          // shiki core + engine + themes → 一个小 chunk；
          // 语言 grammar（@shikijs/langs/*）由 dynamic import 自动拆分
          if ((id.includes('shiki') || id.includes('@shikijs/')) && !id.includes('@shikijs/langs'))
            return 'vendor-shiki'
          if (id.includes('marked') || id.includes('dompurify') || id.includes('morphdom') || id.includes('katex')) return 'vendor-markdown'

          if (id.includes('@tauri-apps/')) return 'vendor-tauri'

          // Radix / floating-ui 是稳定且跨页面共用的一组依赖，独立成 chunk
          // 可避免它们随业务代码每次发版一起失效。
          if (id.includes('@radix-ui/') || id.includes('@floating-ui/')) return 'vendor-radix'
        },
      },
    },
  },

  worker: {
    format: 'es',
  },

  // Tauri CLI 兼容：不清屏，让 Tauri 的日志能保留在终端
  clearScreen: false,

  server: {
    // Tauri mobile dev 需要通过网络访问 Vite dev server
    host: process.env.TAURI_DEV_HOST || false,
    // 固定端口，避免与占用 5173 的其他工具冲突
    port: 5176,
    strictPort: true,
    // 允许所有域名
    allowedHosts: true,

    watch: {
      // src-tauri 下是 Rust 构建产物（target/ 里的 dll/exe 会被 cargo 锁住），
      // 监听它们会导致 vite 报 EBUSY 并退出。
      ignored: ['**/src-tauri/**'],
    },

    proxy: {
      // 开发环境代理 - 将 /api 前缀的请求转发到 OpenCode 后端
      // 注意：Tauri 模式下前端直接请求后端（通过 plugin-http），不走此代理
      '/api': {
        target: 'http://127.0.0.1:4096',
        changeOrigin: true,
        ws: true,
        rewrite: path => path.replace(/^\/api/, ''),
      },
    },
  },
})
