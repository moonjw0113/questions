begin;
create or replace function public.purge_study_content(p_bank text,p_question text default null) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); ids uuid[]; keys text[]; s public.study_sessions; queue jsonb; idx int; st jsonb; field text;
begin
 if u is null then raise exception '로그인 필요'; end if;
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
 delete from public.question_banks b where b.user_id=u and b.id=p_bank and not exists(select 1 from public.questions q where q.user_id=u and q.bank_id=b.id);
end $$;
revoke all on function public.purge_study_content(text,text) from public,anon;
grant execute on function public.purge_study_content(text,text) to authenticated;
commit;
