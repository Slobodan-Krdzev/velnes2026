import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5177,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  preview: {
    port: 4177,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
