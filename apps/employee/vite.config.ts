import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Velnes Employee',
        short_name: 'Velnes',
        description: 'Your day, your treatments, your till.',
        theme_color: '#6f7357',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        // Offline-tolerant reads: serve the last known agenda/catalog
        // when the network is away; writes stay online-only (they
        // carry idempotency keys and must reach the doors).
        runtimeCaching: [
          {
            urlPattern: /\/api\/v1\/(appointments|locations)/,
            method: 'GET',
            handler: 'NetworkFirst',
            options: { cacheName: 'velnes-reads', networkTimeoutSeconds: 3 },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  preview: {
    port: 4174,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
