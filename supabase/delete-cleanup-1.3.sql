-- 삭제 정리: 세트를 지우면 비게 된 단원·과목도 지우고, 관리자가 보낸 세트·문제를 지우면
-- 받아 간 사람의 사본도 함께 지운다. 기존 데이터는 유지됩니다.
-- 이미 init.sql을 설치한 Supabase 프로젝트의 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 됩니다.
begin;
create or replace function public.purge_study_content_for(u uuid,p_bank text,p_question text default null) returns void
language plpgsql security definer set search_path='' as $$
declare ids uuid[]; keys text[]; s public.study_sessions; queue jsonb; idx int; st jsonb; field text; b public.question_banks;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select array_agg(id),array_agg(key) into ids,keys from public.questions where user_id=u and bank_id=p_bank and (p_question is null or key=p_question);
 delete from public.answer_attempts where user_id=u and question_id=any(ids);
 delete from public.review_progress where user_id=u and question_id=any(ids);
 for s in select * from public.study_sessions where user_id=u and exists(select 1 from jsonb_array_elements(state->'queue') r where r->>'id'=any(keys)) loop
   select jsonb_agg(r order by n),count(*) filter(where n <= (s.state->>'index')::int) into queue,idx from jsonb_array_elements(s.state->'queue') with ordinality x(r,n) where not(r->>'id'=any(keys));
   if queue is null then delete from public.study_sessions where user_id=u and id=s.id; continue; end if;
   if s.state->>'status'='active' then idx:=least(idx,jsonb_array_length(queue)-1); end if;
   st:=s.state||jsonb_build_object('queue',queue,'index',idx,'revision',s.revision+1,'updatedAt',now());
   foreach field in array array['answers','durations','choiceOrders'] loop
     st:=jsonb_set(st,array[field],coalesce((select jsonb_object_agg(k,v) from jsonb_each(st->field) x(k,v) where not(split_part(k,'@',1)=any(keys))),'{}'));
   end loop;
   update public.study_sessions set state=st,revision=s.revision+1,updated_at=now() where user_id=u and id=s.id;
 end loop;
 delete from public.question_versions where user_id=u and question_id=any(ids);
 delete from public.questions where user_id=u and id=any(ids);
 select * into b from public.question_banks where user_id=u and id=p_bank;
 delete from public.question_banks x where x.user_id=u and x.id=p_bank and not exists(select 1 from public.questions q where q.user_id=u and q.bank_id=x.id);
 -- 세트가 지워져 비게 된 단원과 과목도 함께 정리한다(학습 범위에 0문제 단원이 남지 않게).
 if b.id is not null and not exists(select 1 from public.question_banks where user_id=u and id=p_bank) then
   delete from public.units n where n.user_id=u and n.subject=b.subject and n.name=b.unit and not exists(select 1 from public.question_banks x where x.user_id=u and x.subject=b.subject and x.unit=b.unit);
   delete from public.subjects j where j.user_id=u and j.name=b.subject and not exists(select 1 from public.units n where n.user_id=u and n.subject=b.subject);
 end if;
end $$;
create or replace function public.purge_study_content(p_bank text,p_question text default null) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
 if u is null then raise exception '로그인 필요'; end if;
 perform public.purge_study_content_for(u,p_bank,p_question);
 -- 관리자 공유를 설치했다면, 이 세트·문제를 받아 간 사람의 사본도 함께 지운다.
 if to_regprocedure('public.purge_shared_copies(uuid,text,text)') is not null then
   execute 'select public.purge_shared_copies($1,$2,$3)' using u,p_bank,p_question;
 end if;
end $$;
revoke all on function public.purge_study_content_for(uuid,text,text) from public,anon,authenticated;
revoke all on function public.purge_study_content(text,text) from public,anon;
grant execute on function public.purge_study_content(text,text) to authenticated;

-- 관리자 공유(admin-sharing.sql)를 설치한 경우에만 공유 사본 삭제 함수를 만든다.
do $migrate$
begin
  if to_regclass('public.shared_question_banks') is not null then
    execute $fn$
create or replace function public.purge_shared_copies(u uuid,p_bank text,p_question text default null) returns void
language plpgsql security definer set search_path='' as $$
declare r uuid; ext text:=case when p_question is null then null else substr(p_question,length(p_bank)+3) end;
begin
 -- 보낸 세트를 받아 간 사람의 사본(풀이 기록 포함)을 지운다.
 for r in select distinct recipient_id from public.shared_question_banks where sender_id=u and received_at is not null and bank->'bank'->>'id'=p_bank and recipient_id<>u loop
   perform public.purge_study_content_for(r,p_bank,p_question);
 end loop;
 -- 아직 받지 않은 공유는 세트째 취소하거나 지운 문제만 뺀다.
 if p_question is null then
   delete from public.shared_question_banks where sender_id=u and received_at is null and bank->'bank'->>'id'=p_bank;
 else
   update public.shared_question_banks set bank=jsonb_set(bank,'{questions}',coalesce((select jsonb_agg(x) from jsonb_array_elements(bank->'questions') x where x->>'id' is distinct from ext),'[]'::jsonb))
     where sender_id=u and received_at is null and bank->'bank'->>'id'=p_bank;
   delete from public.shared_question_banks where sender_id=u and received_at is null and bank->'bank'->>'id'=p_bank and jsonb_array_length(bank->'questions')=0;
 end if;
end $$;
$fn$;
    execute 'revoke all on function public.purge_shared_copies(uuid,text,text) from public,anon,authenticated';
  end if;
end $migrate$;
commit;
