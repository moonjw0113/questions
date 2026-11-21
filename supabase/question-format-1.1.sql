-- 문제 형식 v1.1(수식·표·〈보기〉) 지원. 기존 데이터는 유지됩니다.
-- 이미 init.sql을 설치한 Supabase 프로젝트의 SQL Editor에서 한 번 실행하세요.
-- (새로 설치하는 프로젝트는 init.sql에 이미 들어 있으니 실행하지 않아도 됩니다.)
begin;
create or replace function public.validate_import_question(q jsonb) returns void language plpgsql set search_path = '' as $$
declare b jsonb; x jsonb; k text; n integer; placeholders text[];
begin
  if jsonb_typeof(q) is distinct from 'object' or not (q ?& array['id','type','topic','difficulty','prompt','answer','explanation','tags']) then raise exception '문제 필수 필드 누락'; end if;
  if (q->>'id') !~ '^[a-zA-Z0-9_-]{1,100}$' or jsonb_typeof(q->'id') <> 'string' then raise exception '문제 ID 형식 오류'; end if;
  foreach k in array array['topic','prompt','explanation'] loop
    if jsonb_typeof(q->k) is distinct from 'string' or length(trim(q->>k)) not between 1 and 10000 then raise exception '문제 % 필드 오류', k; end if;
  end loop;
  if jsonb_typeof(q->'difficulty') is distinct from 'number' or (q->>'difficulty') not in ('1','2','3') then raise exception '난이도는 정수 1~3'; end if;
  if jsonb_typeof(q->'tags') is distinct from 'array' or jsonb_array_length(q->'tags') not between 1 and 20 then raise exception '태그 배열 오류'; end if;
  for x in select value from jsonb_array_elements(q->'tags') loop
    if jsonb_typeof(x) <> 'string' or length(trim(x#>>'{}')) not between 1 and 10000 then raise exception '태그 값 오류'; end if;
  end loop;
  if (select count(*) <> count(distinct value) from jsonb_array_elements(q->'tags')) then raise exception '태그 중복'; end if;
  n := case when q ? 'statements' then 1 else 0 end;
  if n = 1 then
    if jsonb_typeof(q->'statements') is distinct from 'array' or jsonb_array_length(q->'statements') not between 2 and 10 then raise exception '보기(statements)는 2~10개'; end if;
    for x in select value from jsonb_array_elements(q->'statements') loop
      if jsonb_typeof(x) <> 'string' or length(trim(x#>>'{}')) not between 1 and 10000 then raise exception '보기 값 오류'; end if;
    end loop;
  end if;
  if jsonb_typeof(q->'answer') is distinct from 'object' then raise exception 'answer 객체 오류'; end if;
  if q->>'type' = 'multiple_choice' then
    if (select count(*) from jsonb_object_keys(q)) <> 9 + n or (select count(*) from jsonb_object_keys(q->'answer')) <> 1 or not ((q->'answer') ? 'option_id') then raise exception '객관식 필드 오류'; end if;
    if jsonb_typeof(q->'options') is distinct from 'array' or jsonb_array_length(q->'options') not between 2 and 10 then raise exception '선택지는 2~10개'; end if;
    for x in select value from jsonb_array_elements(q->'options') loop
      if jsonb_typeof(x) <> 'object' or not(x ?& array['id','text']) or (select count(*) from jsonb_object_keys(x)) <> 2 or jsonb_typeof(x->'id') is distinct from 'string' or (x->>'id') !~ '^[a-zA-Z0-9_-]{1,100}$' or jsonb_typeof(x->'text') <> 'string' or length(trim(x->>'text')) not between 1 and 10000 then raise exception '선택지 형식 오류'; end if;
    end loop;
    if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements(q->'options')) then raise exception '선택지 ID 중복'; end if;
    if jsonb_typeof(q->'answer'->'option_id') is distinct from 'string' or not exists(select 1 from jsonb_array_elements(q->'options') where value->>'id' = q->'answer'->>'option_id') then raise exception '정답 선택지가 없음'; end if;
  elsif q->>'type' in ('short_answer','fill_blank') then
    if (select count(*) from jsonb_object_keys(q)) <> 8 + n or q ? 'options' or (select count(*) from jsonb_object_keys(q->'answer')) <> 1 then raise exception '주관식 필드 오류'; end if;
    if q->>'type' = 'short_answer' then
      b := jsonb_build_array(jsonb_build_object('accepted',q->'answer'->'accepted'));
    else
      b := q->'answer'->'blanks';
      if jsonb_typeof(b) is distinct from 'array' or jsonb_array_length(b) not between 1 and 20 then raise exception '빈칸 배열 오류'; end if;
      select array_agg(m[1]) into placeholders from regexp_matches(q->>'prompt','\{\{([^{}]+)\}\}','g') m;
      if coalesce(cardinality(placeholders),0) <> jsonb_array_length(b) then raise exception '본문의 빈칸 수 불일치'; end if;
      if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements(b)) then raise exception '빈칸 ID 중복'; end if;
    end if;
    for x in select value from jsonb_array_elements(b) loop
      if q->>'type' = 'fill_blank' and (not(x ?& array['id','accepted']) or (select count(*) from jsonb_object_keys(x)) <> 2 or jsonb_typeof(x->'id') is distinct from 'string' or (x->>'id') !~ '^[1-9][0-9]*$' or (select count(*) from unnest(placeholders) p where p = x->>'id') <> 1) then raise exception '빈칸 ID와 {{숫자}} 불일치'; end if;
      if jsonb_typeof(x->'accepted') is distinct from 'array' or jsonb_array_length(x->'accepted') not between 1 and 30 then raise exception '허용 답안 배열 오류'; end if;
      for b in select value from jsonb_array_elements(x->'accepted') loop
        if jsonb_typeof(b) <> 'string' or length(b#>>'{}') > 10000 or public.normalize_study_answer(b#>>'{}') = '' then raise exception '빈 허용 답안'; end if;
      end loop;
      if (select count(*) <> count(distinct value) from jsonb_array_elements(x->'accepted')) then raise exception '허용 답안 중복'; end if;
    end loop;
  else raise exception '지원하지 않는 문제 유형'; end if;
end $$;

create or replace function public.import_question_bank(p_bank jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); b jsonb := p_bank->'bank'; q jsonb; k text; item public.questions; ver integer; payload jsonb; extra jsonb; added integer:=0; updated integer:=0; skipped integer:=0; fmt text := p_bank->>'schema_version'; rich boolean := p_bank->>'schema_version' = '1.1';
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

create or replace function public.restore_study_backup(p_data jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); b jsonb; v jsonb; e jsonb; s jsonb; a jsonb; q public.questions; payload jsonb; v_raw jsonb; grade jsonb; sid uuid; aid uuid; n integer; setting jsonb;
begin
  if u is null then raise exception '로그인 필요'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  if not(p_data ?& array['banks','versions','entries','sessions','attempts','subjects','settings']) or jsonb_array_length(p_data->'versions')>20000 or jsonb_array_length(p_data->'attempts')>100000 then raise exception '백업 형식·크기 오류'; end if;
  for s in select value from jsonb_array_elements(p_data->'subjects') loop
    perform public.manage_study_subject('addSubject',s->>'name');
    for e in select value from jsonb_array_elements(s->'units') loop perform public.manage_study_subject('addUnit',s->>'name',e#>>'{}'); end loop;
  end loop;
  for b in select value from jsonb_array_elements(p_data->'banks') loop
    perform public.manage_study_subject('addSubject',b->>'subject'); perform public.manage_study_subject('addUnit',b->>'subject',b->>'unit');
    if exists(select 1 from public.question_banks where user_id=u and id=b->>'id' and (subject<>b->>'subject' or unit<>b->>'unit')) then raise exception '백업 문제은행 충돌'; end if;
    insert into public.question_banks(user_id,id,title,subject,unit,created_at) values(u,b->>'id',b->>'title',b->>'subject',b->>'unit',(b->>'createdAt')::timestamptz) on conflict do nothing;
  end loop;
  for v in select value from jsonb_array_elements(p_data->'versions') order by (value->'question'->>'version')::integer loop
    payload:=v->'question'; n:=(payload->>'version')::integer;
    v_raw:=jsonb_build_object('id',payload->>'sourceId','type',payload->>'type','topic',payload->>'topic','difficulty',payload->'difficulty','prompt',payload->>'content','explanation',payload->>'explanation','tags',payload->'tags');
    if payload->>'type'='multiple_choice' then v_raw:=v_raw || jsonb_build_object('options',payload->'options','answer',jsonb_build_object('option_id',payload->>'correctOptionId'));
    elsif payload->>'type'='short_answer' then v_raw:=v_raw || jsonb_build_object('answer',jsonb_build_object('accepted',payload->'acceptedAnswers'));
    else v_raw:=v_raw || jsonb_build_object('answer',jsonb_build_object('blanks',(select jsonb_agg(jsonb_build_object('id',x->>'id','accepted',x->'acceptedAnswers')) from jsonb_array_elements(payload->'blanks') x))); end if;
    if payload ? 'statements' then v_raw:=v_raw || jsonb_build_object('statements',payload->'statements'); end if;
    perform public.validate_import_question(v_raw);
    if payload->>'id' is distinct from (v->>'bankId')||'::'||(payload->>'sourceId') then raise exception '외부 문제 키 불일치'; end if;
    if not exists(select 1 from public.question_banks where user_id=u and id=v->>'bankId' and subject=payload->>'subject' and unit=payload->>'unit') then raise exception '백업 문제 과목·단원 불일치'; end if;
    insert into public.questions(user_id,bank_id,external_id,current_version) values(u,v->>'bankId',payload->>'sourceId',n) on conflict(user_id,bank_id,external_id) do nothing;
    select * into strict q from public.questions where user_id=u and bank_id=v->>'bankId' and external_id=payload->>'sourceId';
    if exists(select 1 from public.question_versions x where x.user_id=u and x.question_id=q.id and x.version=n and x.raw<>v_raw) then raise exception '백업 문제 버전 충돌'; end if;
    insert into public.question_versions values(u,q.id,n,v_raw,payload,(payload->>'createdAt')::timestamptz) on conflict do nothing;
    update public.questions set current_version=greatest(current_version,n) where user_id=u and id=q.id;
  end loop;
  for e in select value from jsonb_array_elements(p_data->'entries') loop
    update public.questions set favorite=(e->>'favorite')::boolean,archived=(e->>'archived')::boolean,report=e->>'report' where user_id=u and key=e->>'id';
  end loop;
  for s in select value from jsonb_array_elements(p_data->'sessions') loop
    sid:=(s->>'id')::uuid;
    if exists(select 1 from public.study_sessions where user_id=u and id=sid and (state->'queue'<>s->'queue' or state->'mode'<>s->'mode' or state->'answers'<>s->'answers' or state->'status'<>s->'status')) then raise exception '백업 세션 충돌'; end if;
    insert into public.study_sessions values(u,sid,s || '{"revision":1}'::jsonb,1,(s->>'updatedAt')::timestamptz) on conflict do nothing;
  end loop;
  for a in select value from jsonb_array_elements(p_data->'attempts') loop
    sid:=(a->>'sessionId')::uuid; aid:=(a->>'id')::uuid;
    select * into strict q from public.questions where user_id=u and key=a->>'questionId';
    select v.payload into strict payload from public.question_versions v where v.user_id=u and v.question_id=q.id and version=(a->>'questionVersion')::integer;
    if not exists(select 1 from public.study_sessions s, jsonb_array_elements(s.state->'queue') r where s.user_id=u and s.id=sid and r->>'id'=a->>'questionId' and r->>'version'=a->>'questionVersion') then raise exception '백업 답변의 문제 참조 오류'; end if;
    grade:=public.grade_study_answer(payload,a->'answer');
    if (a->>'manual')::boolean and payload->>'type'='short_answer' then grade:=jsonb_build_object('score',case when (a->>'score')::numeric=1 then 1 else 0 end,'correct',(a->>'score')::numeric=1,'partial',false,'blankResults',jsonb_build_array((a->>'score')::numeric=1)); end if;
    if (a->>'durationMs')::numeric not between 0 and 604800000 then raise exception '백업 소요 시간 오류'; end if;
    if exists(select 1 from public.answer_attempts x where x.user_id=u and x.id=aid and (x.session_id<>sid or x.question_id<>q.id or x.question_version<>(a->>'questionVersion')::integer or x.data->'answer'<>a->'answer')) then raise exception '백업 답변 ID 충돌'; end if;
    insert into public.answer_attempts values(u,aid,sid,q.id,(a->>'questionVersion')::integer,(a->>'answeredAt')::timestamptz,(grade->>'score')::numeric,a || grade) on conflict do nothing;
  end loop;
  perform public.save_study_settings(p_data->'settings');
  for q in select * from public.questions where user_id=u loop perform public.rebuild_study_progress(u,q.id); end loop;
end $$;

-- 관리자 공유(admin-sharing.sql)를 설치한 경우에만 공유 함수를 함께 바꾼다.
do $migrate$
begin
  if to_regclass('public.shared_question_banks') is not null then
    execute $fn$
create or replace function public.share_study_bank(p_bank_id text, p_email text) returns uuid language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); recipient uuid; b public.question_banks; qs jsonb; rich boolean; snapshot jsonb; share_id uuid;
begin
  if not public.study_is_admin() then raise exception '관리자만 문제를 보낼 수 있습니다.'; end if;
  if length(trim(coalesce(p_email,''))) not between 3 and 320 then raise exception '받는 사람의 이메일을 확인해 주세요.'; end if;
  select id into recipient from auth.users where lower(email) = lower(trim(p_email)) and email_confirmed_at is not null limit 1;
  if recipient is null then raise exception '이메일 인증을 완료한 가입자를 찾을 수 없습니다.'; end if;
  select * into b from public.question_banks where user_id=u and id=p_bank_id;
  if not found then raise exception '문제은행을 찾을 수 없습니다.'; end if;
  select jsonb_agg(v.raw order by q.external_id), bool_or(coalesce((v.payload->>'rich')::boolean,false)) into qs, rich from public.questions q join public.question_versions v on v.user_id=q.user_id and v.question_id=q.id and v.version=q.current_version where q.user_id=u and q.bank_id=b.id and not q.archived;
  if qs is null then raise exception '보낼 수 있는 문제가 없습니다.'; end if;
  snapshot := jsonb_build_object('schema_version',case when rich then '1.1' else '1.0' end,'bank',jsonb_build_object('id',b.id,'title',b.title,'subject',b.subject,'unit',b.unit),'questions',qs);
  select id into share_id from public.shared_question_banks where sender_id=u and recipient_id=recipient and received_at is null and bank=snapshot limit 1;
  if share_id is null then
    insert into public.shared_question_banks(sender_id,recipient_id,bank) values(u,recipient,snapshot) returning id into share_id;
  end if;
  return share_id;
end $$;
$fn$;
  end if;
end $migrate$;
commit;
