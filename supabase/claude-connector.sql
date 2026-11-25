-- Claude 커넥터(MCP) 연결. 기존 데이터는 유지됩니다.
-- 이미 init.sql을 설치한 Supabase 프로젝트의 SQL Editor에서 한 번 실행하세요.
-- (새로 설치하는 프로젝트는 init.sql에 이미 들어 있습니다.)
begin;
-- 사용자마다 연결 주소 하나. 원래 토큰은 저장하지 않고 SHA-256 해시만 보관한다.
create table public.connector_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.connector_tokens enable row level security;
revoke all on public.connector_tokens from public, anon, authenticated;

create function public.connector_token_hash(p_token text) returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p_token,''),'UTF8')),'hex');
$$;

-- 앱(로그인한 사용자)이 새 연결 주소를 만든다. 이전 주소는 바로 끊긴다.
create function public.set_connector_token(p_token text) returns void language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception '로그인 필요'; end if;
  if coalesce(length(p_token),0) not between 32 and 200 or p_token !~ '^[A-Za-z0-9_-]+$' then raise exception '연결 토큰 형식 오류'; end if;
  insert into public.connector_tokens(user_id,token_hash) values(u,public.connector_token_hash(p_token))
  on conflict(user_id) do update set token_hash=excluded.token_hash, created_at=now(), last_used_at=null;
end $$;

create function public.revoke_connector_token() returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception '로그인 필요'; end if;
  delete from public.connector_tokens where user_id=auth.uid();
end $$;

create function public.connector_status() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('createdAt',created_at,'lastUsedAt',last_used_at) from public.connector_tokens where user_id=auth.uid();
$$;

-- 커넥터 서버(Edge Function)가 anon 키로 부른다. 토큰으로 사용자를 찾은 뒤
-- 그 사용자로 기존 함수(load_study_data, import_question_bank)를 실행한다.
-- auth.uid()는 request.jwt.claim.sub를 먼저 읽으므로 이 트랜잭션 안에서만 사용자를 바꾼다.
create function public.connector_call(p_token text, p_action text, p_args jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  select user_id into u from public.connector_tokens where token_hash=public.connector_token_hash(p_token);
  if u is null then raise exception '차곡 연결 주소가 올바르지 않거나 끊어졌습니다. 차곡 설정에서 새 주소를 만들어 주세요.'; end if;
  update public.connector_tokens set last_used_at=now() where user_id=u;
  perform set_config('request.jwt.claim.sub', u::text, true);
  if p_action='load' then return public.load_study_data();
  elsif p_action='import' then return public.import_question_bank(p_args);
  elsif p_action='remove_missing' then return to_jsonb(public.remove_missing_questions(p_args->>'bank', p_args->'keep'));
  elsif p_action='purge' then
    if jsonb_typeof(p_args->'questions') is distinct from 'array' then raise exception '지울 문제 목록이 필요합니다'; end if;
    perform public.purge_study_content(p_args->>'bank', (p_args->>'bank')||'::'||(x#>>'{}')) from jsonb_array_elements(p_args->'questions') x;
    return to_jsonb(jsonb_array_length(p_args->'questions'));
  else raise exception '알 수 없는 커넥터 작업: %', p_action; end if;
end $$;

revoke all on function public.connector_token_hash(text), public.set_connector_token(text), public.revoke_connector_token(), public.connector_status(), public.connector_call(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.set_connector_token(text), public.revoke_connector_token(), public.connector_status() to authenticated;
grant execute on function public.connector_call(text,text,jsonb) to anon, authenticated;
commit;
