import path from 'path';
import { defineConfig } from '@lark-apaas/coding-preset-vite-react';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
    },
  },
  optimizeDeps: {
    exclude: ['homr-web', 'onnxruntime-web'],
    include: ['homr-web > @techstark/opencv-js'],
  },
});
