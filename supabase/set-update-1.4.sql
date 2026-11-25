-- 세트 업데이트: 가져오기·커넥터 저장을 받은 사람의 사본에도 바로 반영하고,
-- 새 파일에 없는 문제를 지우는 기능(remove_missing_questions)과 커넥터 삭제 작업을 더한다.
-- 기존 데이터는 유지됩니다. 이미 설치한 Supabase 프로젝트에서 한 번 실행하세요. 여러 번 실행해도 됩니다.
begin;
create or replace function public.import_question_bank_for(u uuid, p_bank jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare b jsonb := p_bank->'bank'; q jsonb; k text; item public.questions; ver integer; payload jsonb; extra jsonb; added integer:=0; updated integer:=0; skipped integer:=0; fmt text := p_bank->>'schema_version'; rich boolean := p_bank->>'schema_version' = '1.1';
begin
  if u is null then raise exception '로그인 필요'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  if jsonb_typeof(p_bank) is distinct from 'object' or coalesce(fmt,'') not in ('1.0','1.1') or (select count(*) from jsonb_object_keys(p_bank)) <> 3 or not(p_bank ?& array['schema_version','bank','questions']) then raise exception 'schema_version 1.0 또는 1.1 문제 파일 필요'; end if;
  if jsonb_typeof(b) is distinct from 'object' or not(b ?& array['id','title','subject','unit']) or (select count(*) from jsonb_object_keys(b)) <> 4 then raise exception 'bank 형식 오류'; end if;
  if jsonb_typeof(b->'id') is distinct from 'string' or (b->>'id') !~ '^[a-zA-Z0-9_-]{1,100}$' then raise exception 'bank.id 형식 오류'; end if;
  foreach k in array array['title','subject','unit'] loop
    if jsonb_typeof(b->k) is distinct from 'string' or length(trim(b->>k)) not between 1 and 200 then raise exception 'bank.%: 1~200자 필요',k; end if;
  end loop;
  if jsonb_typeof(p_bank->'questions') is distinct from 'array' or jsonb_array_length(p_bank->'questions') not between 1 and 2000 then raise exception '문제는 1~2000개'; end if;
  if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements(p_bank->'questions')) then raise exception '문제 ID 중복'; end if;
  if exists(select 1 from public.question_banks where user_id=u and id=b->>'id' and (subject<>b->>'subject' or unit<>b->>'unit')) then raise exception '문제은행 과목·단원 변경 불가'; end if;
  insert into public.subjects values(u,b->>'subject') on conflict do nothing;
  insert into public.units values(u,b->>'subject',b->>'unit') on conflict do nothing;
  insert into public.question_banks(user_id,id,title,subject,unit) values(u,b->>'id',b->>'title',b->>'subject',b->>'unit') on conflict(user_id,id) do update set title=excluded.title;
  for q in select value from jsonb_array_elements(p_bank->'questions') loop
    perform public.validate_import_question(q);
    if not rich and q ? 'statements' then raise exception '보기(statements)는 schema_version 1.1 파일에서만 쓸 수 있습니다'; end if;
    select * into item from public.questions where user_id=u and bank_id=b->>'id' and external_id=q->>'id';
    if found then
      if exists(select 1 from public.question_versions x where x.user_id=u and x.question_id=item.id and x.raw=q and coalesce((x.payload->>'rich')::boolean,false)=rich) then skipped:=skipped+1; continue; end if;
      ver:=item.current_version+1; updated:=updated+1;
    else
      insert into public.questions(user_id,bank_id,external_id) values(u,b->>'id',q->>'id') returning * into item;
      ver:=1; added:=added+1;
    end if;
    extra:=case q->>'type' when 'multiple_choice' then jsonb_build_object('options',q->'options','correctOptionId',q->'answer'->'option_id') when 'short_answer' then jsonb_build_object('acceptedAnswers',q->'answer'->'accepted') else jsonb_build_object('blanks',(select jsonb_agg(jsonb_build_object('id',value->'id','acceptedAnswers',value->'accepted')) from jsonb_array_elements(q->'answer'->'blanks'))) end;
    payload:=jsonb_build_object('id',item.key,'sourceId',q->>'id','version',ver,'subject',b->>'subject','unit',b->>'unit','topic',q->>'topic','tags',q->'tags','content',q->>'prompt','explanation',q->>'explanation','difficulty',q->'difficulty','type',q->>'type','source','JSON 가져오기 · v'||fmt,'createdAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || extra
      || case when rich then jsonb_build_object('rich',true) else '{}'::jsonb end
      || case when q ? 'statements' then jsonb_build_object('statements',q->'statements') else '{}'::jsonb end;
    insert into public.question_versions(user_id,question_id,version,raw,payload) values(u,item.id,ver,q,payload);
    update public.questions set current_version=ver where user_id=u and id=item.id;
  end loop;
  return jsonb_build_object('added',added,'updated',updated,'skipped',skipped);
end $$;
create or replace function public.import_question_bank(p_bank jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  result := public.import_question_bank_for(auth.uid(), p_bank);
  -- 관리자 공유를 설치했다면, 이 세트를 받아 간 사람의 사본에도 바로 반영한다.
  if to_regprocedure('public.push_shared_update(uuid,jsonb)') is not null then
    execute 'select public.push_shared_update($1,$2)' using auth.uid(), p_bank;
  end if;
  return result;
end $$;
-- 세트 업데이트: 새 파일(p_keep: 남길 문제 ID 목록)에 없는 기존 문제를 지운다. 받은 사람의 사본에서도 지운다.
create or replace function public.remove_missing_questions(p_bank text, p_keep jsonb) returns integer language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); k text; n integer := 0;
begin
  if u is null then raise exception '로그인 필요'; end if;
  if jsonb_typeof(p_keep) is distinct from 'array' or jsonb_array_length(p_keep) = 0 then raise exception '남길 문제 목록이 필요합니다'; end if;
  for k in select key from public.questions where user_id=u and bank_id=p_bank and not (to_jsonb(external_id) <@ p_keep) loop
    perform public.purge_study_content(p_bank, k);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.remove_missing_questions(text,jsonb) from public, anon;
grant execute on function public.remove_missing_questions(text,jsonb) to authenticated;
revoke all on function public.import_question_bank_for(uuid,jsonb) from public, anon, authenticated;

create or replace function public.connector_call(p_token text, p_action text, p_args jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
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

do $migrate$
begin
  if to_regclass('public.shared_question_banks') is not null then
    execute $fn$
create or replace function public.push_shared_update(u uuid, p_bank jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare r uuid; bid text := p_bank->'bank'->>'id'; qs jsonb; rich boolean; b public.question_banks;
begin
 -- 받아 간 사람이 아직 그 세트를 가지고 있으면 같은 내용으로 업데이트한다(풀이 기록은 유지).
 -- 받은 사람이 세트를 지웠거나 과목·단원이 달라 실패해도 보낸 사람의 저장은 막지 않는다.
 for r in select distinct recipient_id from public.shared_question_banks where sender_id=u and received_at is not null and bank->'bank'->>'id'=bid and recipient_id<>u loop
   if exists(select 1 from public.question_banks where user_id=r and id=bid) then
     begin
       perform public.import_question_bank_for(r, p_bank);
     exception when others then null;
     end;
   end if;
 end loop;
 -- 아직 받지 않은 공유는 최신 내용으로 바꾼다.
 if exists(select 1 from public.shared_question_banks where sender_id=u and received_at is null and bank->'bank'->>'id'=bid) then
   select * into b from public.question_banks where user_id=u and id=bid;
   select jsonb_agg(v.raw order by q.external_id), bool_or(coalesce((v.payload->>'rich')::boolean,false)) into qs, rich from public.questions q join public.question_versions v on v.user_id=q.user_id and v.question_id=q.id and v.version=q.current_version where q.user_id=u and q.bank_id=bid and not q.archived;
   if qs is not null then
     update public.shared_question_banks set bank=jsonb_build_object('schema_version',case when rich then '1.1' else '1.0' end,'bank',jsonb_build_object('id',b.id,'title',b.title,'subject',b.subject,'unit',b.unit),'questions',qs)
       where sender_id=u and received_at is null and bank->'bank'->>'id'=bid;
   end if;
 end if;
end $$;
$fn$;
    execute 'revoke all on function public.push_shared_update(uuid,jsonb) from public,anon,authenticated';
  end if;
end $migrate$;
commit;
