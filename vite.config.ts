import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'client',
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./client/src', import.meta.url)) },
  },
  optimizeDeps: {
    exclude: ['homr-web', 'onnxruntime-web'],
    include: ['homr-web > @techstark/opencv-js'],
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1600 },
});
