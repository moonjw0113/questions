begin;
create or replace function public.delete_study_session(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); affected uuid[]; q uuid;
begin
  if u is null then raise exception '로그인 필요'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  select array_agg(distinct question_id) into affected from public.answer_attempts where user_id=u and session_id=p_id;
  delete from public.answer_attempts where user_id=u and session_id=p_id;
  delete from public.study_sessions where user_id=u and id=p_id;
  foreach q in array coalesce(affected,'{}'::uuid[]) loop
    delete from public.review_progress where user_id=u and question_id=q;
    perform public.rebuild_study_progress(u,q);
  end loop;
end $$;
revoke all on function public.delete_study_session(uuid) from public,anon;
grant execute on function public.delete_study_session(uuid) to authenticated;
commit;
