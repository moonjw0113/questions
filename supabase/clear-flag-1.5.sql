-- 고쳐진 문제(새 버전으로 저장된 문제)는 '수정·삭제 예정' 표시를 자동으로 푼다.
-- 기존 데이터는 유지됩니다. 이미 설치한 Supabase 프로젝트에서 한 번 실행하세요. 여러 번 실행해도 됩니다.
-- (set-update-1.4.sql을 먼저 실행한 DB에서 실행합니다.)
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
    -- 고쳐진 문제(새 버전)는 '수정·삭제 예정' 표시(report)를 푼다.
    update public.questions set current_version=ver, report='' where user_id=u and id=item.id;
  end loop;
  return jsonb_build_object('added',added,'updated',updated,'skipped',skipped);
end $$;
revoke all on function public.import_question_bank_for(uuid,jsonb) from public, anon, authenticated;
commit;
