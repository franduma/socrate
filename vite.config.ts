import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('/d3')) return 'viz-d3';
            if (id.includes('mammoth')) return 'docx';
            if (id.includes('@google/generative-ai') || id.includes('@google/genai')) return 'ai-sdk';
            if (id.includes('react-dom')) return 'react-dom';
            if (id.includes('/react/')) return 'react-core';
            if (id.includes('lucide-react')) return 'icons';
            if (id.includes('react-markdown') || id.includes('remark-gfm')) return 'markdown';
            if (id.includes('dexie')) return 'storage';
            if (id.includes('motion') || id.includes('framer-motion')) return 'motion';
            if (id.includes('uuid')) return 'utils';
            return 'vendor';
          },
        },
      },
    },
  };
});
