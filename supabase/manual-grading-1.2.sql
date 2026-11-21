-- 빈칸 문제도 "정답으로 처리"(수동 채점)할 수 있게 한다. 기존 데이터는 유지됩니다.
-- 이미 init.sql을 설치한 Supabase 프로젝트의 SQL Editor에서 한 번 실행하세요.
-- (새로 설치하는 프로젝트는 init.sql에 이미 들어 있습니다. 여러 번 실행해도 됩니다.)
begin;
create or replace function public.commit_study_session(p_session jsonb, p_attempts jsonb default '[]') returns void language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); sid uuid:=(p_session->>'id')::uuid; old public.study_sessions; ref jsonb; a jsonb; q public.questions; payload jsonb; grade jsonb; previous public.answer_attempts; aid uuid; atime timestamptz; rev integer; manual boolean; state jsonb;
begin
  if u is null then raise exception '로그인 필요'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  if not(p_session ?& array['id','mode','status','queue','index','answers','durations','choiceOrders','startedAt','updatedAt','completedAt','revision']) or jsonb_typeof(p_session->'mode') is distinct from 'string' or jsonb_typeof(p_session->'status') is distinct from 'string' or jsonb_typeof(p_session->'durations') is distinct from 'object' or jsonb_typeof(p_session->'choiceOrders') is distinct from 'object' or jsonb_typeof(p_session->'revision') is distinct from 'number' or jsonb_typeof(p_session->'index') is distinct from 'number' then raise exception '필수 세션 필드 누락'; end if;
  if p_session->>'mode' not in ('learn','review','exam') or p_session->>'status' not in ('active','completed') or jsonb_typeof(p_session->'queue') is distinct from 'array' or jsonb_array_length(p_session->'queue') not between 1 and 2000 or jsonb_typeof(p_attempts) is distinct from 'array' then raise exception '학습 세션 형식 오류'; end if;
  if (p_session->>'index')::integer not between 0 and jsonb_array_length(p_session->'queue') or jsonb_typeof(p_session->'answers') is distinct from 'object' then raise exception '학습 진행 위치 오류'; end if;
  select * into old from public.study_sessions where user_id=u and id=sid for update;
  if found then
    if old.revision<>(p_session->>'revision')::integer then raise exception '다른 기기에서 세션이 변경되었습니다. 새로고침해 주세요.'; end if;
    if old.state->'queue' <> p_session->'queue' or old.state->>'mode' <> p_session->>'mode' or old.state->>'startedAt' <> p_session->>'startedAt' then raise exception '기존 세션의 문제·모드 변경 불가'; end if;
    if old.state->>'status'='completed' and p_session->>'status'<>'completed' then raise exception '완료한 세션을 다시 열 수 없음'; end if;
    rev:=old.revision+1;
  else
    if (p_session->>'revision')::integer<>0 then raise exception '세션 버전 충돌'; end if; rev:=1;
  end if;
  if (select count(*)<>count(distinct (value->>'id',value->>'version')) from jsonb_array_elements(p_session->'queue')) then raise exception '세션 문제 중복'; end if;
  for ref in select value from jsonb_array_elements(p_session->'queue') loop
    if not exists(select 1 from public.question_versions v join public.questions item on item.user_id=v.user_id and item.id=v.question_id where v.user_id=u and item.key=ref->>'id' and v.version=(ref->>'version')::integer) then raise exception '문제 버전이 존재하지 않음'; end if;
  end loop;
  state:=p_session || jsonb_build_object('revision',rev,'updatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  insert into public.study_sessions values(u,sid,state,rev,now()) on conflict(user_id,id) do update set state=excluded.state,revision=excluded.revision,updated_at=excluded.updated_at;
  if p_session->>'mode'='exam' and p_session->>'status'<>'completed' and jsonb_array_length(p_attempts)>0 then raise exception '시험은 제출 후에만 채점'; end if;
  for a in select value from jsonb_array_elements(p_attempts) loop
    if not(a ?& array['id','questionId','questionVersion','answer','durationMs']) or jsonb_typeof(a->'durationMs') is distinct from 'number' or (a->>'durationMs') !~ '^[0-9]+$' then raise exception '필수 답안 필드 누락'; end if;
    if not exists(select 1 from jsonb_array_elements(p_session->'queue') r where r->>'id'=a->>'questionId' and r->>'version'=a->>'questionVersion') then raise exception '세션에 없는 문제'; end if;
    select * into strict q from public.questions where user_id=u and key=a->>'questionId';
    select v.payload into strict payload from public.question_versions v where v.user_id=u and v.question_id=q.id and v.version=(a->>'questionVersion')::integer;
    if jsonb_typeof(a->'answer') is distinct from 'array' or (a->>'durationMs')::numeric not between 0 and 604800000 then raise exception '답변 또는 소요 시간 오류'; end if;
    if p_session->'answers'->((a->>'questionId')||'@'||(a->>'questionVersion')) is distinct from a->'answer' then raise exception '세션 답변과 기록 불일치'; end if;
    grade:=public.grade_study_answer(payload,a->'answer');
    select * into previous from public.answer_attempts where user_id=u and session_id=sid and question_id=q.id and question_version=(a->>'questionVersion')::integer;
    manual:=a ? 'manualScore';
    if manual then
      if previous.id is null or payload->>'type' not in ('short_answer','fill_blank') or a->>'manualScore' not in ('0','1') then raise exception '단답형·빈칸의 기존 채점만 수정 가능'; end if;
      grade:=jsonb_build_object('score',(a->>'manualScore')::integer,'correct',a->>'manualScore'='1','partial',false,'blankResults',case when payload->>'type'='fill_blank' then (select jsonb_agg(a->>'manualScore'='1') from jsonb_array_elements(payload->'blanks')) else jsonb_build_array(a->>'manualScore'='1') end);
    elsif previous.id is not null and previous.data->'answer'<>a->'answer' then raise exception '이미 제출한 답변은 변경 불가';
    end if;
    aid:=coalesce(previous.id,(a->>'id')::uuid); atime:=coalesce(previous.answered_at,clock_timestamp());
    if exists(select 1 from public.answer_attempts x where x.user_id=u and x.id=aid and (x.session_id<>sid or x.question_id<>q.id or x.question_version<>(a->>'questionVersion')::integer)) then raise exception '답안 ID 충돌'; end if;
    insert into public.answer_attempts values(u,aid,sid,q.id,(a->>'questionVersion')::integer,atime,(grade->>'score')::numeric,
      grade || jsonb_build_object('id',aid,'sessionId',sid,'questionId',q.key,'questionVersion',(a->>'questionVersion')::integer,'answer',a->'answer','durationMs',(a->>'durationMs')::numeric,'mode',p_session->>'mode','answeredAt',to_char(atime at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'manual',manual,'attemptNumber',0,'reviewPace',coalesce(previous.data->>'reviewPace',(select settings->>'reviewPace' from public.profiles where user_id=u),'standard')))
      on conflict(user_id,id) do update set score=excluded.score,data=excluded.data;
    perform public.rebuild_study_progress(u,q.id);
  end loop;
  if p_session->>'status'='completed' and (select count(*) from public.answer_attempts where user_id=u and session_id=sid) <> jsonb_array_length(p_session->'queue') then raise exception '모든 문제를 제출한 뒤 완료할 수 있습니다'; end if;
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
    if (a->>'manual')::boolean and payload->>'type' in ('short_answer','fill_blank') then grade:=jsonb_build_object('score',case when (a->>'score')::numeric=1 then 1 else 0 end,'correct',(a->>'score')::numeric=1,'partial',false,'blankResults',case when payload->>'type'='fill_blank' then (select jsonb_agg((a->>'score')::numeric=1) from jsonb_array_elements(payload->'blanks')) else jsonb_build_array((a->>'score')::numeric=1) end); end if;
    if (a->>'durationMs')::numeric not between 0 and 604800000 then raise exception '백업 소요 시간 오류'; end if;
    if exists(select 1 from public.answer_attempts x where x.user_id=u and x.id=aid and (x.session_id<>sid or x.question_id<>q.id or x.question_version<>(a->>'questionVersion')::integer or x.data->'answer'<>a->'answer')) then raise exception '백업 답변 ID 충돌'; end if;
    insert into public.answer_attempts values(u,aid,sid,q.id,(a->>'questionVersion')::integer,(a->>'answeredAt')::timestamptz,(grade->>'score')::numeric,a || grade) on conflict do nothing;
  end loop;
  perform public.save_study_settings(p_data->'settings');
  for q in select * from public.questions where user_id=u loop perform public.rebuild_study_progress(u,q.id); end loop;
end $$;
commit;
