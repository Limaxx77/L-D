import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.DEV_API_TARGET || 'http://localhost:4000';
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.png', 'images/*.svg', 'images/logo.webp'],
        manifest: {
          name: 'Pastel L&D',
          short_name: 'Pastel L&D',
          description: 'Pastel quentinho, crocante e cheio de sabor! Peça delivery, retirada ou na mesa.',
          lang: 'pt-BR',
          theme_color: '#2A1810',
          background_color: '#FFF8E6',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//, /^\/socket\.io\//],
          // Dados da API nunca são servidos do cache (preços e status precisam ser atuais).
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/uploads/') || /\.(webp|png|jpg|svg)$/.test(url.pathname),
              handler: 'CacheFirst',
              options: { cacheName: 'images', expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 3600 } },
            },
          ],
        },
      }),
    ],
    server: {
      port: 5173,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/uploads': { target: apiTarget, changeOrigin: true },
        '/socket.io': { target: apiTarget, ws: true, changeOrigin: true },
      },
    },
  };
});
