import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { loadEnv } from 'vite';
import { embeddedContent } from './vite.content';

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
          name: '李④끝 쨌 留ㅼ씪 ?볦씠???섏쓽 怨듬?',
          short_name: '李④끝',
          lang: 'ko',
          description: '臾몄젣瑜??怨? 湲곗뼲???볤퀬, ??寃껋쑝濡?留뚮뱶??留ㅼ씪??怨듬?.',
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
          globPatterns: ['**/*.{js,css,html,svg,png,json,txt,woff2}'],
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
