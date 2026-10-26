import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import example from '../public/examples/biology.json';
import { type AppData, emptyFilters } from '../src/domain/types';
import { createSession, filterQuestions } from '../src/domain/study';
import { gradeAnswer } from '../src/domain/grading';
import { scheduleReview } from '../src/domain/review';
const user = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222';
let db: PGlite;
async function rpc(name: string, ...args: unknown[]) {
  const result = await db.query<{ result: unknown }>(
    `select public.${name}(${args.map((_, i) => `$${i + 1}::jsonb`).join(',')}) as result`,
    args.map((a) => JSON.stringify(a)),
  );
  return result.rows[0].result;
}
const load = () => rpc('load_study_data') as Promise<AppData>;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${user}'),('${other}'); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`,
  );
  await db.exec(readFileSync('supabase/init.sql', 'utf8'));
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`,
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe('Supabase PostgreSQL contract', () => {
  it('imports all three types, deduplicates, versions changes, isolates bank identity', async () => {
    expect(await rpc('import_question_bank', example)).toEqual({
      added: 4,
      updated: 0,
      skipped: 0,
    });
    expect(await rpc('import_question_bank', example)).toEqual({
      added: 0,
      updated: 0,
      skipped: 4,
    });
    const modified = structuredClone(example);
    modified.questions[0].explanation += ' 추가 설명.';
    expect(await rpc('import_question_bank', modified)).toEqual({
      added: 0,
      updated: 1,
      skipped: 3,
    });
    const otherBank = structuredClone(example);
    otherBank.bank.id = 'another-bank';
    expect(await rpc('import_question_bank', otherBank)).toEqual({
      added: 4,
      updated: 0,
      skipped: 0,
    });
    const d = await load();
    expect(d.entries).toHaveLength(8);
    expect(d.versions).toHaveLength(9);
    expect(d.entries[0].dbId).not.toEqual(d.entries[0].id);
  });
  it('rejects invalid import atomically', async () => {
    const bad = structuredClone(example) as any;
    bad.bank.id = 'bad-bank';
    bad.questions[1].answer.accepted = ['   '];
    await expect(rpc('import_question_bank', bad)).rejects.toThrow();
    expect((await load()).banks.some((b) => b.id === 'bad-bank')).toBe(false);
  });
  it('saves attempts, partial grades, resume state, progress and immutable history', async () => {
    let d = await load();
    const qs = filterQuestions(d, emptyFilters).filter((q) => q.id.startsWith(example.bank.id));
    let s = createSession(d, qs, 'learn', qs.length);
    await rpc('commit_study_session', s, []);
    d = await load();
    s = d.sessions.find((x) => x.id === s.id)!;
    const inputs = qs.map((q) => ({
      id: crypto.randomUUID(),
      questionId: q.id,
      questionVersion: q.version,
      answer:
        q.type === 'multiple_choice'
          ? [q.correctOptionId]
          : q.type === 'short_answer'
            ? [q.acceptedAnswers[0].replace(' ', '\u00a0')]
            : [q.blanks[0].acceptedAnswers[0], 'wrong'],
      durationMs: 1000,
    }));
    inputs.forEach((a) => (s.answers[`${a.questionId}@${a.questionVersion}`] = a.answer));
    s.status = 'completed';
    s.index = s.queue.length;
    s.completedAt = new Date().toISOString();
    await rpc('commit_study_session', s, inputs);
    d = await load();
    expect(d.attempts).toHaveLength(4);
    expect(d.progress).toHaveLength(4);
    expect(d.attempts.filter((a) => a.partial)).toHaveLength(2);
    for (const a of d.attempts) {
      const q = d.versions.find(
        (v) => v.question.id === a.questionId && v.question.version === a.questionVersion,
      )!.question;
      expect(a.score).toBe(gradeAnswer(q, a.answer).score);
    }
    await expect(rpc('commit_study_session', s, inputs)).rejects.toThrow('다른 기기');
    const changed = structuredClone(example);
    changed.questions[0].prompt += ' (수정)';
    await rpc('import_question_bank', changed);
    expect((await load()).attempts).toHaveLength(4);
  });
  it('manual correction recomputes history and exam grading waits for final submission', async () => {
    let d = await load();
    const original = d.attempts.find((a) =>
      d.versions.some(
        (v) =>
          v.question.id === a.questionId &&
          v.question.version === a.questionVersion &&
          v.question.type === 'short_answer',
      ),
    )!;
    let s = d.sessions.find((s) => s.id === original.sessionId)!;
    await rpc('commit_study_session', s, [
      {
        id: original.id,
        questionId: original.questionId,
        questionVersion: original.questionVersion,
        answer: original.answer,
        durationMs: original.durationMs,
        manualScore: 0,
      },
    ]);
    d = await load();
    expect(d.attempts.find((a) => a.id === original.id)).toMatchObject({
      manual: true,
      score: 0,
      correct: false,
    });
    const q = d.versions.find(
      (v) =>
        v.question.id === original.questionId && v.question.version === original.questionVersion,
    )!.question;
    const answer = q.type === 'short_answer' ? [q.acceptedAnswers[0]] : [];
    const count = d.attempts.length;
    s = createSession(d, [q], 'exam', 1);
    s.answers[`${q.id}@${q.version}`] = answer;
    await rpc('commit_study_session', s, []);
    d = await load();
    s = d.sessions.find((x) => x.id === s.id)!;
    expect(d.attempts).toHaveLength(count);
    const input = {
      id: crypto.randomUUID(),
      questionId: q.id,
      questionVersion: q.version,
      answer,
      durationMs: 1000,
    };
    await expect(rpc('commit_study_session', s, [input])).rejects.toThrow('시험은 제출 후');
    s.status = 'completed';
    s.index = 1;
    s.completedAt = new Date().toISOString();
    await rpc('commit_study_session', s, [input]);
    d = await load();
    expect(d.attempts).toHaveLength(count + 1);
    expect(d.attempts.find((a) => a.id === input.id)?.correct).toBe(true);
    let expected: AppData['progress'][number] | undefined;
    d.attempts
      .filter((a) => a.questionId === q.id)
      .forEach((a) => {
        expected = scheduleReview(
          expected,
          a.score,
          a.answeredAt,
          a.reviewPace || 'standard',
          q.id,
        );
      });
    const actual = d.progress.find((p) => p.questionId === q.id)!;
    expect(actual.interval).toBeCloseTo(expected!.interval);
    expect(actual.ease).toBeCloseTo(expected!.ease);
    expect(actual.mastery).toBe(expected!.mastery);
  });
  it('rejects attempt ID reuse across sessions atomically', async () => {
    const d = await load(),
      old = d.attempts[0],
      q = d.versions.find(
        (v) => v.question.id === old.questionId && v.question.version === old.questionVersion,
      )!.question;
    const s = createSession(d, [q], 'learn', 1);
    s.answers[`${q.id}@${q.version}`] = old.answer;
    await expect(
      rpc('commit_study_session', s, [
        {
          id: old.id,
          questionId: q.id,
          questionVersion: q.version,
          answer: old.answer,
          durationMs: 10,
        },
      ]),
    ).rejects.toThrow('ID 충돌');
    const after = await load();
    expect(after.sessions.some((x) => x.id === s.id)).toBe(false);
    expect(after.attempts).toEqual(d.attempts);
  });
  it('enforces RLS and direct-write restrictions', async () => {
    await db.exec(`select set_config('request.jwt.claim.sub','${other}',false);`);
    const d = await load();
    expect(d.entries).toEqual([]);
    expect(d.attempts).toEqual([]);
    expect((await db.query('select * from public.questions')).rows).toHaveLength(0);
    await expect(
      db.query(
        `insert into public.answer_attempts(user_id,id) values('${other}',gen_random_uuid())`,
      ),
    ).rejects.toThrow();
    await db.exec(`select set_config('request.jwt.claim.sub','${user}',false);`);
  });
  it('blocks anonymous access and cross-user question references', async () => {
    const d = await load();
    const q = d.versions[0].question;
    await db.exec(`select set_config('request.jwt.claim.sub','${other}',false);`);
    await expect(
      rpc('commit_study_session', createSession(d, [q], 'learn', 1), []),
    ).rejects.toThrow('문제 버전');
    await db.exec('set role anon');
    await expect(rpc('load_study_data')).rejects.toThrow();
    await db.exec(
      `set role authenticated;select set_config('request.jwt.claim.sub','${user}',false);`,
    );
  });
  it('restores backups atomically and idempotently, preserves attempts and versions', async () => {
    const backup = await load();
    await db.exec(`select set_config('request.jwt.claim.sub','${other}',false);`);
    await rpc('restore_study_backup', backup);
    await rpc('restore_study_backup', backup);
    const d = await load();
    expect(d.attempts).toHaveLength(backup.attempts.length);
    expect(d.versions).toHaveLength(backup.versions.length);
    expect(d.attempts.map((a) => a.answeredAt)).toEqual(backup.attempts.map((a) => a.answeredAt));
    await db.exec(`select set_config('request.jwt.claim.sub','${user}',false);`);
  });
});
