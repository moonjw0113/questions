-- 차곡 v1.0 — run once in a NEW Supabase project's SQL Editor.
-- External contract: schema_version / bank(id,title,subject,unit) / questions.
-- External identity (bank_id, external_id), internal UUID, and immutable versions are separate.
begin;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{"theme":"light","dailyGoal":20,"reviewPace":"standard","shuffleQuestions":true,"shuffleChoices":true}'
);
create table public.subjects (
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 200), primary key(user_id,name)
);
create table public.units (
  user_id uuid not null, subject text not null, name text not null check(length(trim(name)) between 1 and 200),
  primary key(user_id,subject,name), foreign key(user_id,subject) references public.subjects(user_id,name)
);
create table public.question_banks (
  user_id uuid not null, id text not null, title text not null, subject text not null, unit text not null,
  created_at timestamptz not null default now(), primary key(user_id,id),
  foreign key(user_id,subject,unit) references public.units(user_id,subject,name)
);
create table public.questions (
  user_id uuid not null, id uuid not null default gen_random_uuid(), bank_id text not null, external_id text not null,
  key text generated always as (bank_id || '::' || external_id) stored,
  current_version integer not null default 1 check(current_version > 0),
  favorite boolean not null default false, archived boolean not null default false, report text not null default '',
  primary key(user_id,id), unique(user_id,bank_id,external_id), unique(user_id,key),
  foreign key(user_id,bank_id) references public.question_banks(user_id,id)
);
create table public.question_versions (
  user_id uuid not null, question_id uuid not null, version integer not null check(version > 0),
  raw jsonb not null, payload jsonb not null, created_at timestamptz not null default now(),
  primary key(user_id,question_id,version), foreign key(user_id,question_id) references public.questions(user_id,id)
);
alter table public.questions add constraint current_question_version_fk
  foreign key(user_id,id,current_version) references public.question_versions(user_id,question_id,version) deferrable initially deferred;
create table public.study_sessions (
  user_id uuid not null references auth.users(id) on delete cascade, id uuid not null,
  state jsonb not null, revision integer not null default 1, updated_at timestamptz not null default now(),
  primary key(user_id,id)
);
create table public.answer_attempts (
  user_id uuid not null, id uuid not null, session_id uuid not null, question_id uuid not null, question_version integer not null,
  answered_at timestamptz not null default now(), score numeric not null check(score between 0 and 1), data jsonb not null,
  primary key(user_id,id), unique(user_id,session_id,question_id,question_version),
  foreign key(user_id,session_id) references public.study_sessions(user_id,id),
  foreign key(user_id,question_id,question_version) references public.question_versions(user_id,question_id,version)
);
create table public.review_progress (
  user_id uuid not null, question_id uuid not null, next_due timestamptz not null, data jsonb not null,
  primary key(user_id,question_id), foreign key(user_id,question_id) references public.questions(user_id,id)
);
create index attempt_date_idx on public.answer_attempts(user_id,answered_at desc);
create index attempt_question_idx on public.answer_attempts(user_id,question_id,answered_at);
create index due_idx on public.review_progress(user_id,next_due);
create index sessions_updated_idx on public.study_sessions(user_id,updated_at desc);
create index version_tags_idx on public.question_versions using gin((payload->'tags'));

do $$ declare t text; begin
  foreach t in array array['profiles','subjects','units','question_banks','questions','question_versions','study_sessions','answer_attempts','review_progress'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy own_data on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
  end loop;
end $$;
grant update(favorite,archived,report) on public.questions to authenticated;

create function public.normalize_study_answer(v text) returns text language sql immutable set search_path = '' as $$
  -- The Unicode whitespace set matches JavaScript \s, including mobile copy/paste NBSP.
  select regexp_replace(lower(normalize(coalesce(v,''), NFC)), U&'[[:space:],，。!！?？;；:''"“”‘’\00a0\1680\2000-\200a\2028\2029\202f\205f\3000\feff]', '', 'g');
$$;
create function public.validate_import_question(q jsonb) returns void language plpgsql set search_path = '' as $$
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
  if jsonb_typeof(q->'answer') is distinct from 'object' then raise exception 'answer 객체 오류'; end if;
  if q->>'type' = 'multiple_choice' then
    if (select count(*) from jsonb_object_keys(q)) <> 9 or (select count(*) from jsonb_object_keys(q->'answer')) <> 1 or not ((q->'answer') ? 'option_id') then raise exception '객관식 필드 오류'; end if;
    if jsonb_typeof(q->'options') is distinct from 'array' or jsonb_array_length(q->'options') not between 2 and 10 then raise exception '선택지는 2~10개'; end if;
    for x in select value from jsonb_array_elements(q->'options') loop
      if jsonb_typeof(x) <> 'object' or not(x ?& array['id','text']) or (select count(*) from jsonb_object_keys(x)) <> 2 or jsonb_typeof(x->'id') is distinct from 'string' or (x->>'id') !~ '^[a-zA-Z0-9_-]{1,100}$' or jsonb_typeof(x->'text') <> 'string' or length(trim(x->>'text')) not between 1 and 10000 then raise exception '선택지 형식 오류'; end if;
    end loop;
    if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements(q->'options')) then raise exception '선택지 ID 중복'; end if;
    if jsonb_typeof(q->'answer'->'option_id') is distinct from 'string' or not exists(select 1 from jsonb_array_elements(q->'options') where value->>'id' = q->'answer'->>'option_id') then raise exception '정답 선택지가 없음'; end if;
  elsif q->>'type' in ('short_answer','fill_blank') then
    if (select count(*) from jsonb_object_keys(q)) <> 8 or q ? 'options' or (select count(*) from jsonb_object_keys(q->'answer')) <> 1 then raise exception '주관식 필드 오류'; end if;
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

create function public.import_question_bank(p_bank jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); b jsonb := p_bank->'bank'; q jsonb; k text; item public.questions; ver integer; payload jsonb; extra jsonb; added integer:=0; updated integer:=0; skipped integer:=0;
begin
  if u is null then raise exception '로그인 필요'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  if jsonb_typeof(p_bank) is distinct from 'object' or p_bank->>'schema_version' is distinct from '1.0' or (select count(*) from jsonb_object_keys(p_bank)) <> 3 or not(p_bank ?& array['schema_version','bank','questions']) then raise exception 'schema_version 1.0 문제 파일 필요'; end if;
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
    select * into item from public.questions where user_id=u and bank_id=b->>'id' and external_id=q->>'id';
    if found then
      if exists(select 1 from public.question_versions where user_id=u and question_id=item.id and raw=q) then skipped:=skipped+1; continue; end if;
      ver:=item.current_version+1; updated:=updated+1;
    else
      insert into public.questions(user_id,bank_id,external_id) values(u,b->>'id',q->>'id') returning * into item;
      ver:=1; added:=added+1;
    end if;
    extra:=case q->>'type' when 'multiple_choice' then jsonb_build_object('options',q->'options','correctOptionId',q->'answer'->'option_id') when 'short_answer' then jsonb_build_object('acceptedAnswers',q->'answer'->'accepted') else jsonb_build_object('blanks',(select jsonb_agg(jsonb_build_object('id',value->'id','acceptedAnswers',value->'accepted')) from jsonb_array_elements(q->'answer'->'blanks'))) end;
    payload:=jsonb_build_object('id',item.key,'sourceId',q->>'id','version',ver,'subject',b->>'subject','unit',b->>'unit','topic',q->>'topic','tags',q->'tags','content',q->>'prompt','explanation',q->>'explanation','difficulty',q->'difficulty','type',q->>'type','source','ChatGPT Work · JSON v1.0','createdAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || extra;
    insert into public.question_versions(user_id,question_id,version,raw,payload) values(u,item.id,ver,q,payload);
    update public.questions set current_version=ver where user_id=u and id=item.id;
  end loop;
  return jsonb_build_object('added',added,'updated',updated,'skipped',skipped);
end $$;

create function public.grade_study_answer(q jsonb, a jsonb) returns jsonb language plpgsql immutable set search_path = '' as $$
declare results jsonb := '[]'; ok boolean; b jsonb; i integer:=0; score numeric;
begin
  if jsonb_typeof(a) is distinct from 'array' then raise exception '답변은 문자열 배열'; end if;
  if exists(select 1 from jsonb_array_elements(a) where jsonb_typeof(value)<>'string' or length(value#>>'{}')>10000) then raise exception '답변 형식 오류'; end if;
  if q->>'type'='multiple_choice' then results:=jsonb_build_array(coalesce(a->>0=q->>'correctOptionId',false));
  elsif q->>'type'='short_answer' then
    select exists(select 1 from jsonb_array_elements_text(q->'acceptedAnswers') x where public.normalize_study_answer(x)=public.normalize_study_answer(a->>0) and public.normalize_study_answer(a->>0)<>'') into ok;
    results:=jsonb_build_array(ok);
  else
    for b in select value from jsonb_array_elements(q->'blanks') loop
      select exists(select 1 from jsonb_array_elements_text(b->'acceptedAnswers') x where public.normalize_study_answer(x)=public.normalize_study_answer(a->>i) and public.normalize_study_answer(a->>i)<>'') into ok;
      results:=results || jsonb_build_array(ok); i:=i+1;
    end loop;
  end if;
  select count(*) filter(where value='true')::numeric / count(*) into score from jsonb_array_elements(results);
  return jsonb_build_object('score',score,'correct',score=1,'partial',score>0 and score<1,'blankResults',results);
end $$;

create function public.rebuild_study_progress(u uuid, qid uuid) returns void language plpgsql set search_path = '' as $$
declare a public.answer_attempts; p jsonb; reps integer:=0; inter double precision:=0; ease double precision:=2.5; oldease double precision; quality integer; total integer:=0; correct integer:=0; recent numeric[]:='{}'; weighted numeric; mastery integer; due timestamptz; factor numeric:=1; score numeric;
begin
  for a in select * from public.answer_attempts where user_id=u and question_id=qid order by answered_at,id loop
    factor:=case a.data->>'reviewPace' when 'gentle' then 1.3 when 'intensive' then 0.7 else 1 end;
    score:=a.score; oldease:=ease; quality:=case when score=1 then 4 when score>0 then 2 else 1 end;
    ease:=greatest(1.3,ease+0.1-(5-quality)*(0.08+(5-quality)*0.02));
    reps:=case when score=1 then reps+1 else 0 end;
    inter:=case when score<1 then 10.0/1440 else least(365,(case when reps=1 then 1 when reps=2 then 6 else greatest(1,round(inter*oldease)) end)*factor) end;
    total:=total+1; correct:=correct+case when score=1 then 1 else 0 end;
    recent:=array_append(recent,score); if cardinality(recent)>10 then recent:=recent[2:11]; end if;
    select sum(v*n)/sum(n) into weighted from unnest(recent) with ordinality x(v,n);
    mastery:=floor(weighted*least(1,(reps+1)/5.0)*100+0.5);
    due:=a.answered_at+inter*interval '1 day';
    update public.answer_attempts set data=data || jsonb_build_object('attemptNumber',total) where user_id=u and id=a.id;
  end loop;
  if total>0 then
    select jsonb_build_object('questionId',key,'repetitions',reps,'interval',inter,'ease',ease,'mastery',mastery,'nextDue',to_char(due at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'totalAttempts',total,'correctCount',correct,'recentScores',to_jsonb(recent)) into p from public.questions where user_id=u and id=qid;
    insert into public.review_progress values(u,qid,due,p) on conflict(user_id,question_id) do update set next_due=excluded.next_due,data=excluded.data;
  end if;
end $$;

create function public.commit_study_session(p_session jsonb, p_attempts jsonb default '[]') returns void language plpgsql security definer set search_path = '' as $$
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
      if previous.id is null or payload->>'type'<>'short_answer' or a->>'manualScore' not in ('0','1') then raise exception '단답형의 기존 채점만 수정 가능'; end if;
      grade:=jsonb_build_object('score',(a->>'manualScore')::integer,'correct',a->>'manualScore'='1','partial',false,'blankResults',jsonb_build_array(a->>'manualScore'='1'));
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

create function public.save_study_settings(p_settings jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); begin
  if u is null then raise exception '로그인 필요'; end if;
  if not(p_settings ?& array['theme','dailyGoal','reviewPace','shuffleQuestions','shuffleChoices']) or p_settings->>'theme' not in ('light','dark','system') or p_settings->>'reviewPace' not in ('standard','gentle','intensive') or (p_settings->>'dailyGoal')::integer not between 1 and 500 or jsonb_typeof(p_settings->'shuffleQuestions')<>'boolean' or jsonb_typeof(p_settings->'shuffleChoices')<>'boolean' then raise exception '설정 값 오류'; end if;
  insert into public.profiles values(u,p_settings) on conflict(user_id) do update set settings=excluded.settings;
end $$;
create function public.manage_study_subject(p_action text,p_subject text,p_unit text default '') returns void language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); begin
  if u is null then raise exception '로그인 필요'; end if;
  if length(trim(p_subject)) not between 1 and 200 then raise exception '과목 이름 오류'; end if;
  if p_action='addSubject' then insert into public.subjects values(u,p_subject) on conflict do nothing;
  elsif p_action='addUnit' then
    if length(trim(p_unit)) not between 1 and 200 then raise exception '단원 이름 오류'; end if;
    insert into public.units values(u,p_subject,p_unit) on conflict do nothing;
  elsif p_action='deleteUnit' then delete from public.units where user_id=u and subject=p_subject and name=p_unit;
  elsif p_action='deleteSubject' then
    delete from public.units where user_id=u and subject=p_subject;
    delete from public.subjects where user_id=u and name=p_subject;
  else raise exception '지원하지 않는 작업'; end if;
end $$;

create function public.load_study_data() returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'settings',coalesce((select settings from public.profiles where user_id=auth.uid()),'{"theme":"light","dailyGoal":20,"reviewPace":"standard","shuffleQuestions":true,"shuffleChoices":true}'::jsonb),
    'subjects',coalesce((select jsonb_agg(jsonb_build_object('name',s.name,'units',coalesce((select jsonb_agg(n.name order by n.name) from public.units n where n.user_id=s.user_id and n.subject=s.name),'[]'))) from public.subjects s where s.user_id=auth.uid()),'[]'),
    'banks',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'title',b.title,'subject',b.subject,'unit',b.unit,'createdAt',b.created_at)) from public.question_banks b where b.user_id=auth.uid()),'[]'),
    'entries',coalesce((select jsonb_agg(jsonb_build_object('id',q.key,'dbId',q.id,'bankId',q.bank_id,'currentVersion',q.current_version,'favorite',q.favorite,'archived',q.archived,'report',q.report)) from public.questions q where q.user_id=auth.uid()),'[]'),
    'versions',coalesce((select jsonb_agg(jsonb_build_object('bankId',q.bank_id,'question',v.payload)) from public.question_versions v join public.questions q on q.user_id=v.user_id and q.id=v.question_id where v.user_id=auth.uid()),'[]'),
    'sessions',coalesce((select jsonb_agg(state order by updated_at desc) from public.study_sessions where user_id=auth.uid()),'[]'),
    'attempts',coalesce((select jsonb_agg(data order by answered_at,id) from public.answer_attempts where user_id=auth.uid()),'[]'),
    'progress',coalesce((select jsonb_agg(data) from public.review_progress where user_id=auth.uid()),'[]')
  );
$$;

-- Backup restore preserves question version numbers and all attempt timestamps.
-- Restore is an atomic merge, never a destructive replacement. Conflicting versions abort.
create function public.restore_study_backup(p_data jsonb) returns void language plpgsql security definer set search_path = '' as $$
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

-- All helper functions are private. Only these explicit, owner-checked RPCs are callable.
revoke all on function public.normalize_study_answer(text),public.validate_import_question(jsonb),public.import_question_bank(jsonb),public.grade_study_answer(jsonb,jsonb),public.rebuild_study_progress(uuid,uuid),public.commit_study_session(jsonb,jsonb),public.save_study_settings(jsonb),public.manage_study_subject(text,text,text),public.load_study_data(),public.restore_study_backup(jsonb) from public, anon, authenticated;
grant execute on function public.import_question_bank(jsonb),public.commit_study_session(jsonb,jsonb),public.save_study_settings(jsonb),public.manage_study_subject(text,text,text),public.load_study_data(),public.restore_study_backup(jsonb) to authenticated;
commit;
