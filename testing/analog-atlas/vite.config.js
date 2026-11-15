import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { manualChunks(id) {
      if (id.includes('node_modules/maplibre-gl')) return 'maplibre';
      if (id.includes('node_modules/three')) return 'three';
    } } },
  },
});
