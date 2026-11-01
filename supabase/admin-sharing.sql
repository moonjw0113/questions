-- 기존 데이터는 유지됩니다. init.sql 설치 후 SQL Editor에서 한 번 실행하세요.
begin;
create table public.study_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table public.shared_question_banks (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  bank jsonb not null,
  created_at timestamptz not null default now(),
  received_at timestamptz
);
create index shared_question_banks_recipient_idx on public.shared_question_banks(recipient_id, created_at desc);
alter table public.study_admins enable row level security;
alter table public.shared_question_banks enable row level security;
revoke all on public.study_admins, public.shared_question_banks from public, anon, authenticated;

create function public.study_is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.study_admins where user_id = auth.uid());
$$;

create function public.share_study_bank(p_bank_id text, p_email text) returns uuid language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); recipient uuid; b public.question_banks; qs jsonb; snapshot jsonb; share_id uuid;
begin
  if not public.study_is_admin() then raise exception '관리자만 문제를 보낼 수 있습니다.'; end if;
  if length(trim(coalesce(p_email,''))) not between 3 and 320 then raise exception '받는 사람의 이메일을 확인해 주세요.'; end if;
  select id into recipient from auth.users where lower(email) = lower(trim(p_email)) and email_confirmed_at is not null limit 1;
  if recipient is null then raise exception '이메일 인증을 완료한 가입자를 찾을 수 없습니다.'; end if;
  select * into b from public.question_banks where user_id=u and id=p_bank_id;
  if not found then raise exception '문제은행을 찾을 수 없습니다.'; end if;
  select jsonb_agg(v.raw order by q.external_id) into qs from public.questions q join public.question_versions v on v.user_id=q.user_id and v.question_id=q.id and v.version=q.current_version where q.user_id=u and q.bank_id=b.id and not q.archived;
  if qs is null then raise exception '보낼 수 있는 문제가 없습니다.'; end if;
  snapshot := jsonb_build_object('schema_version','1.0','bank',jsonb_build_object('id',b.id,'title',b.title,'subject',b.subject,'unit',b.unit),'questions',qs);
  select id into share_id from public.shared_question_banks where sender_id=u and recipient_id=recipient and received_at is null and bank=snapshot limit 1;
  if share_id is null then
    insert into public.shared_question_banks(sender_id,recipient_id,bank) values(u,recipient,snapshot) returning id into share_id;
  end if;
  return share_id;
end $$;

create function public.list_shared_study_banks() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',bank->'bank'->>'title','subject',bank->'bank'->>'subject','unit',bank->'bank'->>'unit','count',jsonb_array_length(bank->'questions'),'createdAt',created_at) order by created_at desc),'[]'::jsonb)
  from public.shared_question_banks where recipient_id=auth.uid() and received_at is null;
$$;

create function public.receive_shared_study_bank(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare snapshot jsonb; result jsonb;
begin
  if auth.uid() is null then raise exception '로그인 필요'; end if;
  select bank into snapshot from public.shared_question_banks where id=p_id and recipient_id=auth.uid() and received_at is null for update;
  if not found then raise exception '받을 수 있는 문제은행이 없습니다.'; end if;
  result := public.import_question_bank(snapshot);
  update public.shared_question_banks set received_at=now() where id=p_id;
  return result;
end $$;
revoke all on function public.study_is_admin(), public.share_study_bank(text,text), public.list_shared_study_banks(), public.receive_shared_study_bank(uuid) from public, anon, authenticated;
grant execute on function public.study_is_admin(), public.share_study_bank(text,text), public.list_shared_study_banks(), public.receive_shared_study_bank(uuid) to authenticated;
commit;
