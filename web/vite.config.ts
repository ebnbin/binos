import { readFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { logoVariant } from './src/logo.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), appFiles()],
  server: {
    proxy: {
      '/install': { target: `http://127.0.0.1:${process.env.BINOS_SERVER_PORT ?? 3000}` },
      '/api': {
        target: `http://127.0.0.1:${process.env.BINOS_SERVER_PORT ?? 3000}`,
        ws: true,
        // 后端断开时也断开页面这一端，和正式版一样，页面的实时推送才会重连
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, _req, res) => {
            proxyRes.on('close', () => {
              if (!proxyRes.complete) {
                res.destroy()
              }
            })
          })
        },
      },
    },
  },
})

// 图标和 manifest 都由 design/logo.svg 生成：开发时直接提供，构建时输出到 dist
function appFiles(): Plugin {
  const source = readFileSync(new URL('../design/logo.svg', import.meta.url), 'utf8')
  const png = (rounded: boolean, size: number) =>
    new Resvg(logoVariant(source, { rounded }), { fitTo: { mode: 'width', value: size } }).render().asPng()
  const manifest = {
    id: '/',
    name: 'binOS',
    short_name: 'binOS',
    lang: 'zh-CN',
    start_url: '/',
    scope: '/',
    // 桌面上装成 app 后去掉浏览器的标题栏，由菜单栏占据窗口顶部
    display_override: ['window-controls-overlay'],
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
  let files: Map<string, { type: string; body: string | Uint8Array }> | undefined
  const generate = () =>
    (files ??= new Map<string, { type: string; body: string | Uint8Array }>([
      ['favicon.svg', { type: 'image/svg+xml', body: logoVariant(source, { rounded: true, dark: true }) }],
      // 系统会给这两种加圆角，所以是全方形；apple-touch-icon 的透明部分会变成黑色
      ['apple-touch-icon.png', { type: 'image/png', body: png(false, 180) }],
      ['icon-maskable.png', { type: 'image/png', body: png(false, 512) }],
      ['icon-192.png', { type: 'image/png', body: png(true, 192) }],
      ['icon-512.png', { type: 'image/png', body: png(true, 512) }],
      ['manifest.webmanifest', { type: 'application/manifest+json', body: JSON.stringify(manifest) }],
    ]))
  return {
    name: 'binos-app-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = generate().get(req.url?.split('?')[0].slice(1) ?? '')
        if (!file) {
          return next()
        }
        res.setHeader('Content-Type', file.type)
        res.end(file.body)
      })
    },
    generateBundle() {
      for (const [fileName, { body }] of generate()) {
        this.emitFile({ type: 'asset', fileName, source: body })
      }
    },
  }
}
