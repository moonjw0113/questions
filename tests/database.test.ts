import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import example from '../public/examples/biology.json';
import { type AppData, emptyFilters } from '../src/domain/types';
import { createSession, filterQuestions } from '../src/domain/study';
import { gradeAnswer } from '../src/domain/grading';
import { scheduleReview } from '../src/domain/review';
import { createMcpHandler } from '../src/mcp/server';
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
    `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz); insert into auth.users values('${user}','admin@example.com',now()),('${other}','student@example.com',now()); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`,
  );
  await db.exec(readFileSync('supabase/init.sql', 'utf8'));
  await db.exec(readFileSync('supabase/admin-sharing.sql', 'utf8'));
  // 기존 DB용 업데이트 SQL도 이미 최신인 DB에 다시 적용해 오류 없이 도는지 확인한다.
  await db.exec(readFileSync('supabase/question-format-1.1.sql', 'utf8'));
  await db.exec(readFileSync('supabase/manual-grading-1.2.sql', 'utf8'));
  await db.exec(readFileSync('supabase/delete-cleanup-1.3.sql', 'utf8'));
  await db.exec(`insert into public.study_admins(user_id) values ('${user}')`);
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
  it('fill-in-the-blank answers can be accepted manually, multiple choice cannot', async () => {
    let d = await load();
    const pick = (type: string) =>
      d.versions.find((v) => v.question.type === type && v.bankId === example.bank.id)!.question;
    for (const q of [pick('fill_blank'), pick('multiple_choice')]) {
      const s = createSession(d, [q], 'learn', 1);
      const answer = q.type === 'fill_blank' ? q.blanks.map(() => '비슷한 답') : ['Z'];
      s.answers[`${q.id}@${q.version}`] = answer;
      const input = {
        id: crypto.randomUUID(),
        questionId: q.id,
        questionVersion: q.version,
        answer,
        durationMs: 10,
      };
      await rpc('commit_study_session', s, [input]);
      d = await load();
      const saved = d.sessions.find((x) => x.id === s.id)!;
      const accept = rpc('commit_study_session', saved, [{ ...input, manualScore: 1 }]);
      if (q.type === 'multiple_choice') {
        await expect(accept).rejects.toThrow('단답형·빈칸');
        continue;
      }
      await accept;
      d = await load();
      expect(d.attempts.find((a) => a.id === input.id)).toMatchObject({
        manual: true,
        correct: true,
        score: 1,
        blankResults: answer.map(() => true),
      });
    }
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
  it('only administrators can share and only the intended user can receive a snapshot', async () => {
    const bank = structuredClone(example);
    bank.bank.id = 'shared-test';
    await rpc('import_question_bank', bank);
    const send = () =>
      db.query<{ id: string }>(
        "select public.share_study_bank('shared-test', 'student@example.com') id",
      );
    const id = (await send()).rows[0].id;
    expect((await send()).rows[0].id).toBe(id);
    await expect(
      db.query('select public.receive_shared_study_bank($1::uuid)', [id]),
    ).rejects.toThrow();
    expect(
      (await db.query<{ result: unknown[] }>('select public.list_shared_study_banks() result'))
        .rows[0].result,
    ).toHaveLength(0);
    await db.exec(`select set_config('request.jwt.claim.sub','${other}',false)`);
    await expect(send()).rejects.toThrow('관리자만');
    expect(
      (await db.query<{ result: unknown[] }>('select public.list_shared_study_banks() result'))
        .rows[0].result,
    ).toHaveLength(1);
    expect(
      (
        await db.query<{ result: { added: number } }>(
          'select public.receive_shared_study_bank($1::uuid) result',
          [id],
        )
      ).rows[0].result.added,
    ).toBe(4);
    await expect(
      db.query('select public.receive_shared_study_bank($1::uuid)', [id]),
    ).rejects.toThrow();
    expect((await load()).banks.some((b) => b.id === 'shared-test')).toBe(true);
    await db.exec(`select set_config('request.jwt.claim.sub','${user}',false)`);
  });
  it('imports, versions and shares schema v1.1 banks with statements', async () => {
    const science = JSON.parse(readFileSync('public/examples/science-v1_1.json', 'utf8'));
    expect(await rpc('import_question_bank', science)).toEqual({
      added: 4,
      updated: 0,
      skipped: 0,
    });
    expect(await rpc('import_question_bank', science)).toMatchObject({ skipped: 4 });
    const q = (await load()).versions.find((v) => v.bankId === science.bank.id)!.question;
    expect(q).toMatchObject({ rich: true, source: 'JSON 가져오기 · v1.1' });
    expect(q.statements).toEqual(science.questions[0].statements);
    // 공유하면 v1.1 그대로 전달된다.
    const id = (
      await db.query<{ id: string }>(
        `select public.share_study_bank('${science.bank.id}', 'student@example.com') id`,
      )
    ).rows[0].id;
    await db.exec(`select set_config('request.jwt.claim.sub','${other}',false)`);
    await db.query('select public.receive_shared_study_bank($1::uuid)', [id]);
    const shared = (await load()).versions.find((v) => v.bankId === science.bank.id)!.question;
    expect(shared).toMatchObject({ rich: true, statements: q.statements });
    await db.exec(`select set_config('request.jwt.claim.sub','${user}',false)`);
    // v1.0 파일에는 보기를 넣을 수 없고, 같은 글이라도 v1.0으로 가져오면 새 버전이 된다.
    const asOld = structuredClone(science);
    asOld.schema_version = '1.0';
    await expect(rpc('import_question_bank', asOld)).rejects.toThrow('schema_version 1.1');
    for (const x of asOld.questions) delete x.statements;
    expect(await rpc('import_question_bank', asOld)).toMatchObject({ updated: 4 });
    await expect(
      rpc('import_question_bank', { ...science, schema_version: '2.0' }),
    ).rejects.toThrow();
  });
  it('Claude connector tokens act only as their owner and can be revoked', async () => {
    const token = 'tok_' + 'a1B2'.repeat(10);
    const call = (t: string, action: string, args: unknown = {}) =>
      db
        .query<{ result: unknown }>('select public.connector_call($1,$2,$3::jsonb) result', [
          t,
          action,
          JSON.stringify(args),
        ])
        .then((r) => r.rows[0].result);
    await expect(db.query("select public.set_connector_token('short')")).rejects.toThrow();
    await db.query('select public.set_connector_token($1)', [token]);
    expect(
      (await db.query<{ s: unknown }>('select public.connector_status() s')).rows[0].s,
    ).toMatchObject({ lastUsedAt: null });
    // 토큰 표는 직접 읽을 수 없고, 원래 토큰이 아니라 해시만 저장된다.
    await expect(db.query('select * from public.connector_tokens')).rejects.toThrow(
      'permission denied',
    );
    await db.exec('reset role');
    expect(
      (await db.query<{ h: string }>('select token_hash h from public.connector_tokens')).rows[0].h,
    ).toMatch(/^[0-9a-f]{64}$/);
    await db.exec('set role authenticated');
    const mine = await load();
    // 커넥터 서버처럼 로그인 정보 없는 anon으로 부른다.
    await db.exec(`set role anon; select set_config('request.jwt.claim.sub','',false);`);
    await expect(db.query('select public.load_study_data()')).rejects.toThrow();
    const viaConnector = (await call(token, 'load')) as typeof mine;
    expect(viaConnector.banks.map((b) => b.id).sort()).toEqual(mine.banks.map((b) => b.id).sort());
    const bank = structuredClone(example);
    bank.bank.id = 'connector-bank';
    expect(await call(token, 'import', bank)).toMatchObject({ added: 4 });
    await expect(call('tok_wrong' + 'x'.repeat(30), 'load')).rejects.toThrow('연결 주소');
    await expect(call(token, 'drop')).rejects.toThrow('알 수 없는 커넥터 작업');
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${other}',false);`,
    );
    expect((await load()).banks.some((b) => b.id === 'connector-bank')).toBe(false);
    await db.exec(`select set_config('request.jwt.claim.sub','${user}',false);`);
    expect((await load()).banks.some((b) => b.id === 'connector-bank')).toBe(true);
    expect(
      (await db.query<{ s: { lastUsedAt: string } }>('select public.connector_status() s')).rows[0]
        .s.lastUsedAt,
    ).toBeTruthy();
    // MCP 서버를 실제 DB 함수에 이어서 처음부터 끝까지 돌린다(커넥터 서버는 anon으로 부른다).
    const handler = createMcpHandler(async (t, action, args) => {
      await db.exec(`set role anon; select set_config('request.jwt.claim.sub','',false);`);
      try {
        return await call(t, action, args);
      } finally {
        await db.exec(
          `set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`,
        );
      }
    });
    const tool = async (name: string, args: unknown) => {
      const res = await handler(
        new Request(`https://x.supabase.co/functions/v1/chagok-mcp/${token}`, {
          method: 'POST',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name, arguments: args },
          }),
        }),
      );
      return (await res.json()).result as { content: { text: string }[]; isError?: boolean };
    };
    const science = JSON.parse(readFileSync('public/examples/science-v1_1.json', 'utf8'));
    science.bank.id = 'connector-science';
    expect((await tool('import_question_bank', { bank: science })).content[0].text).toContain(
      '새 문제 4개',
    );
    const banks = JSON.parse((await tool('list_question_banks', {})).content[0].text).banks;
    expect(banks).toContainEqual(
      expect.objectContaining({ id: 'connector-science', questions: 4, schema_version: '1.1' }),
    );
    expect((await tool('get_study_result', {})).isError).toBeUndefined();
    await db.query('select public.revoke_connector_token()');
    await expect(call(token, 'load')).rejects.toThrow('연결 주소');
    expect((await tool('list_question_banks', {})).isError).toBe(true);
  });
  it('permanently removes a bank and its attempts while preserving unrelated banks', async () => {
    const before = await load();
    await db.query('select public.purge_study_content($1,null)', [example.bank.id]);
    const after = await load();
    expect(after.banks.map((b) => b.id)).toEqual(
      expect.arrayContaining(before.banks.filter((b) => b.id !== example.bank.id).map((b) => b.id)),
    );
    expect(after.banks.some((b) => b.id === example.bank.id)).toBe(false);
    expect(after.entries.some((e) => e.bankId === example.bank.id)).toBe(false);
    expect(after.attempts.some((a) => a.questionId.startsWith(example.bank.id + '::'))).toBe(false);
  });
  it('removes units and subjects left empty by a deleted bank, keeps shared ones', async () => {
    const make = (id: string, unit: string) => {
      const b = structuredClone(example);
      b.bank = { id, title: id, subject: '정리과목', unit };
      return b;
    };
    await rpc('import_question_bank', make('tidy-a', '단원1'));
    await rpc('import_question_bank', make('tidy-b', '단원2'));
    await rpc('import_question_bank', make('tidy-c', '단원2'));
    const units = async () => (await load()).subjects.find((s) => s.name === '정리과목')?.units;
    await db.query('select public.purge_study_content($1,null)', ['tidy-a']);
    expect(await units()).toEqual(['단원2']);
    // 같은 단원을 쓰는 세트가 남아 있으면 단원은 그대로다.
    await db.query('select public.purge_study_content($1,null)', ['tidy-b']);
    expect(await units()).toEqual(['단원2']);
    // 문제 하나만 지우면 세트·단원은 남는다.
    const key = (await load()).entries.find((e) => e.bankId === 'tidy-c')!.id;
    await db.query('select public.purge_study_content($1,$2)', ['tidy-c', key]);
    expect(await units()).toEqual(['단원2']);
    await db.query('select public.purge_study_content($1,null)', ['tidy-c']);
    expect(await units()).toBeUndefined();
  });
  it("deleting a shared bank or question also deletes recipients' copies", async () => {
    const bank = structuredClone(example);
    bank.bank = { ...bank.bank, id: 'shared-purge', unit: '공유 삭제 단원' };
    await rpc('import_question_bank', bank);
    const share = async () =>
      (
        await db.query<{ id: string }>(
          "select public.share_study_bank('shared-purge', 'student@example.com') id",
        )
      ).rows[0].id;
    const received = await share();
    const as = (who: string) =>
      db.exec(`select set_config('request.jwt.claim.sub','${who}',false)`);
    await as(other);
    await db.query('select public.receive_shared_study_bank($1::uuid)', [received]);
    const guestEntries = async () =>
      (await load()).entries.filter((e) => e.bankId === 'shared-purge').map((e) => e.id);
    const before = await guestEntries();
    expect(before).toHaveLength(bank.questions.length);
    // 받은 사람이 푼 기록이 있어도 함께 지워진다.
    let d = await load();
    const q = d.versions.find((v) => v.question.id === before[0])!.question;
    const s = createSession(d, [q], 'learn', 1, { unsolvedOnly: false });
    await rpc('commit_study_session', s, []);
    // 아직 받지 않은 공유도 하나 만든다.
    await as(user);
    const pending = await share();
    expect(pending).not.toBe(received);
    // 관리자가 문제 하나를 지운다 → 받은 사람의 그 문제와 대기 중 공유의 그 문제가 빠진다.
    await db.query('select public.purge_study_content($1,$2)', ['shared-purge', before[0]]);
    await as(other);
    expect(await guestEntries()).toEqual(before.slice(1));
    d = await load();
    expect(d.sessions.some((x) => x.id === s.id)).toBe(false);
    const list = async () =>
      (
        await db.query<{ r: { id: string; count: number }[] }>(
          'select public.list_shared_study_banks() r',
        )
      ).rows[0].r;
    expect((await list()).find((x) => x.id === pending)?.count).toBe(bank.questions.length - 1);
    // 세트를 통째로 지우면 받은 사람의 세트·단원과 대기 중 공유도 사라진다.
    await as(user);
    await db.query('select public.purge_study_content($1,null)', ['shared-purge']);
    await as(other);
    d = await load();
    expect(d.banks.some((b) => b.id === 'shared-purge')).toBe(false);
    expect(d.subjects.flatMap((x) => x.units)).not.toContain('공유 삭제 단원');
    expect((await list()).some((x) => x.id === pending)).toBe(false);
    // 받은 사람이 스스로 지우는 것은 보낸 사람에게 영향을 주지 않는다(보낸 사람 쪽은 이미 없음).
    await as(user);
  });
});
