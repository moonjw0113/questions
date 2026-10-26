import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { loadEnv } from 'vite';
import { readFileSync } from 'node:fs';
const embeddedContent = {
  name: 'chagok-content',
  resolveId(id: string) {
    if (id === 'virtual:study-content') return '\0chagok-content';
  },
  load(id: string) {
    if (id !== '\0chagok-content') return;
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
    return `export const schema=${read('public/question-bank.schema.json')};export const biology=${read('public/examples/biology.json')};export const generationPrompt=${JSON.stringify(read('public/prompts/generate.txt'))};export const analysisPrompt=${JSON.stringify(read('public/prompts/analyze.txt'))};`;
  },
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const base = env.VITE_BASE_PATH || '/';
  if (!base.startsWith('/') || !base.endsWith('/'))
    throw Error('VITE_BASE_PATH must start and end with /');
  const key = env.VITE_SUPABASE_ANON_KEY || '';
  if (key && key !== 'YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY') {
    let safe = key.startsWith('sb_publishable_');
    if (!safe) {
      try {
        safe = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon';
      } catch {
        /* fail closed */
      }
    }
    if (!safe)
      throw Error(
        'VITE_SUPABASE_ANON_KEY must be a publishable or anon key. Secret/service_role keys are forbidden.',
      );
  }
  return {
    base,
    plugins: [
      embeddedContent,
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
        manifest: {
          name: '차곡 · 매일 쌓이는 나의 공부',
          short_name: '차곡',
          lang: 'ko',
          description: '문제를 풀고, 기억을 쌓고, 내 것으로 만드는 매일의 공부.',
          theme_color: '#36775a',
          background_color: '#f7f8f5',
          display: 'standalone',
          start_url: base,
          scope: base,
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,json,txt}'],
          navigateFallback: 'index.html',
          // Auth and user data are never cached by the service worker.
          runtimeCaching: [],
        },
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            supabase: ['@supabase/supabase-js'],
            validation: ['ajv'],
          },
        },
      },
    },
    test: { environment: 'node', testTimeout: 30000, fileParallelism: false },
  };
});
