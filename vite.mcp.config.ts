// Claude 커넥터 서버(src/mcp/server.ts)를 Supabase Edge Function용 ES 모듈 하나로 묶는다.
// pnpm mcp:build → supabase/functions/chagok-mcp/dist/server.js
import { defineConfig } from 'vite';
import { embeddedContent } from './vite.content';

export default defineConfig({
  plugins: [embeddedContent],
  publicDir: false,
  build: {
    outDir: 'supabase/functions/chagok-mcp/dist',
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    copyPublicDir: false,
    lib: {
      entry: 'src/mcp/server.ts',
      formats: ['es'],
      fileName: () => 'server.js',
    },
  },
});
