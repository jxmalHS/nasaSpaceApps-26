import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import terrain from './api/terrain.js';
const terrainApi = { name:'measured-terrain', configureServer(server){server.middlewares.use('/api/terrain',terrain)}, configurePreviewServer(server){server.middlewares.use('/api/terrain',terrain)} };

export default defineConfig({
  plugins: [react(),terrainApi],
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
