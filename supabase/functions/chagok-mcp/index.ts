// 차곡 Claude 커넥터 (Supabase Edge Function, Deno)
// 배포 전에 pnpm mcp:build로 dist/server.js를 만든다. 자세한 순서는 docs/claude-connector.md.
// @ts-nocheck -- Deno 런타임 파일이라 웹앱 TypeScript 검사 대상이 아니다.
import { createMcpHandler, restCallDb } from './dist/server.js';

const url = Deno.env.get('SUPABASE_URL');
// 웹앱과 같은 공개 키(publishable 또는 anon). 비밀 키(service_role)는 쓰지 않는다.
const key = Deno.env.get('CHAGOK_PUBLIC_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY');
if (!url || !key) throw new Error('SUPABASE_URL과 공개 키(CHAGOK_PUBLIC_KEY 또는 SUPABASE_ANON_KEY)가 필요합니다.');

Deno.serve(createMcpHandler(restCallDb(url, key)));
