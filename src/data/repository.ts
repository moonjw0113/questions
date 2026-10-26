import type { AppData, AttemptInput, QuestionBank, Settings, StudySession } from '../domain/types';
import { getQuestion } from '../domain/types';
import {
  inspectImport,
  parseBank,
  normalizeBank,
  toImportQuestion,
  canonical,
  externalKey,
} from '../domain/import';
import { gradeAnswer } from '../domain/grading';
import { scheduleReview } from '../domain/review';
import { demoData } from './demo';
import { supabase } from './supabase';

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
}
export interface Repository {
  load(): Promise<AppData>;
  importBank(bank: QuestionBank): Promise<ImportResult>;
  commitSession(session: StudySession, attempts?: AttemptInput[]): Promise<void>;
  updateQuestion(
    id: string,
    changes: { favorite?: boolean; archived?: boolean; report?: string },
  ): Promise<void>;
  saveSettings(settings: Settings): Promise<void>;
  manageSubject(
    action: 'addSubject' | 'deleteSubject' | 'addUnit' | 'deleteUnit',
    subject: string,
    unit?: string,
  ): Promise<void>;
  restore(data: AppData): Promise<void>;
}
export function validateBackup(raw: unknown): AppData {
  const d = raw as AppData;
  if (
    !d ||
    !['subjects', 'banks', 'entries', 'versions', 'sessions', 'attempts', 'progress'].every((k) =>
      Array.isArray(d[k as keyof AppData]),
    ) ||
    !d.settings
  )
    throw Error('차곡 백업 형식이 아닙니다.');
  if (d.versions.length > 20000 || d.attempts.length > 100000)
    throw Error('한 번에 복원할 수 있는 크기를 초과했습니다.');
  for (const key of ['banks', 'entries', 'sessions', 'attempts'] as const)
    if (new Set(d[key].map((x) => x.id)).size !== d[key].length)
      throw Error('백업에 중복된 식별자가 있습니다.');
  if (
    new Set(d.versions.map((v) => `${v.question.id}@${v.question.version}`)).size !==
    d.versions.length
  )
    throw Error('백업 문제 버전이 중복됩니다.');
  for (const b of d.banks) {
    if (!b.createdAt || Number.isNaN(Date.parse(b.createdAt)))
      throw Error('문제은행 생성 날짜가 잘못되었습니다.');
    for (const v of d.versions.filter((v) => v.bankId === b.id)) {
      const parsed = parseBank(
        JSON.stringify({
          schema_version: '1.0',
          bank: { id: b.id, title: b.title, subject: b.subject, unit: b.unit },
          questions: [toImportQuestion(v.question)],
        }),
      );
      if (parsed.errors.length) throw Error(parsed.errors.join('\n'));
      if (
        v.question.id !== externalKey(b.id, v.question.sourceId) ||
        v.question.subject !== b.subject ||
        v.question.unit !== b.unit ||
        !Number.isInteger(v.question.version) ||
        v.question.version < 1 ||
        Number.isNaN(Date.parse(v.question.createdAt))
      )
        throw Error('백업의 내부 문제 식별자·과목·단원·버전·날짜가 잘못되었습니다.');
    }
  }
  if (d.versions.some((v) => !d.banks.some((b) => b.id === v.bankId)))
    throw Error('연결된 문제은행이 없습니다.');
  for (const e of d.entries)
    if (
      !d.versions.some(
        (v) =>
          v.question.id === e.id &&
          v.question.version === e.currentVersion &&
          v.bankId === e.bankId,
      )
    )
      throw Error('현재 문제 버전을 찾을 수 없습니다.');
  if (d.versions.some((v) => !d.entries.some((e) => e.id === v.question.id)))
    throw Error('문제 메타데이터가 누락되었습니다.');
  for (const s of d.sessions) {
    if (
      !/^[0-9a-f-]{36}$/i.test(s.id) ||
      !['learn', 'review', 'exam'].includes(s.mode) ||
      !['active', 'completed'].includes(s.status) ||
      !Array.isArray(s.queue) ||
      !s.queue.length ||
      !s.answers ||
      !s.durations ||
      !s.choiceOrders ||
      !Number.isInteger(s.index) ||
      s.index < 0 ||
      s.index > s.queue.length ||
      s.queue.some((q) => !getQuestion(d, q))
    )
      throw Error('세션 형식 또는 문제 참조가 잘못되었습니다.');
  }
  for (const a of d.attempts) {
    const s = d.sessions.find((s) => s.id === a.sessionId);
    if (
      !s ||
      !s.queue.some((q) => q.id === a.questionId && q.version === a.questionVersion) ||
      !Array.isArray(a.answer) ||
      a.answer.some((x) => typeof x !== 'string') ||
      !Number.isInteger(a.durationMs) ||
      a.durationMs < 0 ||
      a.durationMs > 604800000 ||
      Number.isNaN(Date.parse(a.answeredAt))
    )
      throw Error('풀이 기록의 연결 또는 형식이 잘못되었습니다.');
  }
  if (
    !['light', 'dark', 'system'].includes(d.settings.theme) ||
    !['standard', 'gentle', 'intensive'].includes(d.settings.reviewPace) ||
    !Number.isInteger(d.settings.dailyGoal) ||
    d.settings.dailyGoal < 1 ||
    d.settings.dailyGoal > 500 ||
    typeof d.settings.shuffleQuestions !== 'boolean' ||
    typeof d.settings.shuffleChoices !== 'boolean'
  )
    throw Error('설정 값이 잘못되었습니다.');
  return d;
}
export class DemoRepository implements Repository {
  private key = 'chagok-demo-v1';
  private read(): AppData {
    const raw = localStorage.getItem(this.key);
    if (raw) {
      try {
        return validateBackup(JSON.parse(raw));
      } catch {
        throw Error(
          '체험 저장 기록을 읽지 못했습니다. 원본 데이터는 보존되어 있습니다. 복구용 원본을 다운로드해 주세요.',
        );
      }
    }
    return demoData();
  }
  private write(d: AppData) {
    localStorage.setItem(this.key, JSON.stringify(d));
  }
  async load() {
    const d = this.read();
    this.write(d);
    return d;
  }
  async importBank(bank: QuestionBank) {
    const d = this.read(),
      result = inspectImport(bank, d);
    if (result.errors.length) throw Error(result.errors.join('\n'));
    const old = d.banks.find((b) => b.id === bank.bank.id);
    if (old) Object.assign(old, bank.bank);
    else d.banks.push({ ...bank.bank, createdAt: new Date().toISOString() });
    for (const q of normalizeBank(bank, d).questions) {
      let subject = d.subjects.find((s) => s.name === q.subject);
      if (!subject) {
        subject = { name: q.subject, units: [] };
        d.subjects.push(subject);
      }
      if (!subject.units.includes(q.unit)) subject.units.push(q.unit);
      const e = d.entries.find((e) => e.id === q.id);
      if (!d.versions.some((v) => v.question.id === q.id && v.question.version === q.version))
        d.versions.push({ bankId: bank.bank.id, question: q });
      if (e) e.currentVersion = Math.max(e.currentVersion, q.version);
      else
        d.entries.push({
          id: q.id,
          bankId: bank.bank.id,
          currentVersion: q.version,
          favorite: false,
          archived: false,
          report: '',
        });
    }
    this.write(d);
    return result;
  }
  async commitSession(session: StudySession, inputs: AttemptInput[] = []) {
    const d = this.read(),
      old = d.sessions.find((s) => s.id === session.id);
    if (old && old.revision !== session.revision)
      throw Error('다른 기기에서 세션이 변경되었습니다. 새로고침 후 이어서 학습해 주세요.');
    for (const input of inputs) {
      const q = getQuestion(d, { id: input.questionId, version: input.questionVersion });
      if (!q) throw Error('문제를 찾을 수 없습니다.');
      const grade = gradeAnswer(q, input.answer);
      const previous = d.attempts.find(
        (a) =>
          a.sessionId === session.id && a.questionId === q.id && a.questionVersion === q.version,
      );
      const manual =
        input.manualScore !== undefined && q.type === 'short_answer' && Boolean(previous);
      if (input.manualScore !== undefined && !manual)
        throw Error('단답형의 저장된 채점만 수정할 수 있습니다.');
      const a = {
        ...grade,
        ...input,
        id: previous?.id || input.id,
        sessionId: session.id,
        answeredAt: previous?.answeredAt || new Date().toISOString(),
        mode: session.mode,
        attemptNumber:
          previous?.attemptNumber || d.attempts.filter((a) => a.questionId === q.id).length + 1,
        manual,
        reviewPace: previous?.reviewPace || d.settings.reviewPace,
      };
      if (manual)
        Object.assign(a, {
          score: input.manualScore,
          correct: input.manualScore === 1,
          partial: false,
          blankResults: [input.manualScore === 1],
        });
      d.attempts = [...d.attempts.filter((v) => v.id !== a.id), a];
    }
    d.sessions = [
      ...d.sessions.filter((s) => s.id !== session.id),
      { ...session, revision: session.revision + 1, updatedAt: new Date().toISOString() },
    ];
    this.rebuild(d);
    this.write(d);
  }
  private rebuild(d: AppData) {
    d.progress = [];
    [...d.attempts]
      .sort((a, b) => a.answeredAt.localeCompare(b.answeredAt))
      .forEach((a) => {
        const p = scheduleReview(
          d.progress.find((p) => p.questionId === a.questionId),
          a.score,
          a.answeredAt,
          a.reviewPace || 'standard',
          a.questionId,
        );
        a.attemptNumber = p.totalAttempts;
        d.progress = [...d.progress.filter((p) => p.questionId !== a.questionId), p];
      });
  }
  async updateQuestion(
    id: string,
    changes: { favorite?: boolean; archived?: boolean; report?: string },
  ) {
    const d = this.read();
    Object.assign(
      d.entries.find((e) => e.id === id)!,
      changes,
    );
    this.write(d);
  }
  async saveSettings(settings: Settings) {
    const d = this.read();
    d.settings = settings;
    this.write(d);
  }
  async manageSubject(
    action: 'addSubject' | 'deleteSubject' | 'addUnit' | 'deleteUnit',
    subject: string,
    unit = '',
  ) {
    const d = this.read(),
      s = d.subjects.find((s) => s.name === subject);
    if (action === 'addSubject' && !s) d.subjects.push({ name: subject, units: [] });
    if (action === 'addUnit' && s && !s.units.includes(unit)) s.units.push(unit);
    if (
      action.startsWith('delete') &&
      (d.versions.some(
        (v) =>
          v.question.subject === subject &&
          (action === 'deleteSubject' || v.question.unit === unit),
      ) ||
        (action === 'deleteSubject' && d.banks.some((b) => b.subject === subject)))
    )
      throw Error('연결된 문제나 문제은행이 있는 과목·단원은 삭제할 수 없습니다.');
    if (action === 'deleteSubject') d.subjects = d.subjects.filter((s) => s.name !== subject);
    if (action === 'deleteUnit' && s) s.units = s.units.filter((u) => u !== unit);
    this.write(d);
  }
  async restore(raw: AppData) {
    const incoming = validateBackup(raw),
      d = this.read();
    // Stage all changes in memory; persist only if the entire backup is compatible.
    for (const v of incoming.versions) {
      const b = incoming.banks.find((b) => b.id === v.bankId)!;
      const result = inspectImport(
        {
          schema_version: '1.0',
          bank: { id: b.id, title: b.title, subject: b.subject, unit: b.unit },
          questions: [toImportQuestion(v.question)],
        },
        d,
      );
      if (result.errors.length) throw Error(result.errors.join('\n'));
      const existingVersion = d.versions.find(
        (x) => x.question.id === v.question.id && x.question.version === v.question.version,
      );
      if (
        existingVersion &&
        canonical(toImportQuestion(existingVersion.question)) !==
          canonical(toImportQuestion(v.question))
      )
        throw Error('백업 문제 버전 충돌');
      if (!existingVersion) d.versions.push(v);
    }
    incoming.banks.forEach((b) => {
      if (!d.banks.some((x) => x.id === b.id)) d.banks.push(b);
    });
    incoming.entries.forEach((e) => {
      const old = d.entries.find((x) => x.id === e.id);
      if (old) old.currentVersion = Math.max(e.currentVersion, old.currentVersion);
      else d.entries.push(e);
    });
    incoming.subjects.forEach((s) => {
      const old = d.subjects.find((x) => x.name === s.name);
      if (old) old.units = [...new Set([...old.units, ...s.units])];
      else d.subjects.push(s);
    });
    incoming.sessions.forEach((s) => {
      const old = d.sessions.find((x) => x.id === s.id);
      if (
        old &&
        ['queue', 'mode', 'answers', 'status'].some(
          (k) => canonical(old[k as keyof typeof old]) !== canonical(s[k as keyof typeof s]),
        )
      )
        throw Error('백업 세션 충돌');
      if (!old) d.sessions.push(s);
    });
    incoming.attempts.forEach((a) => {
      const old = d.attempts.find((x) => x.id === a.id);
      if (
        old &&
        (old.sessionId !== a.sessionId ||
          old.questionId !== a.questionId ||
          old.questionVersion !== a.questionVersion ||
          canonical(old.answer) !== canonical(a.answer))
      )
        throw Error('백업 답변 ID 충돌');
      if (
        !d.attempts.some(
          (x) =>
            x.id === a.id ||
            (x.sessionId === a.sessionId &&
              x.questionId === a.questionId &&
              x.questionVersion === a.questionVersion),
        )
      ) {
        const q = getQuestion(d, { id: a.questionId, version: a.questionVersion })!;
        d.attempts.push({
          ...a,
          ...(a.manual && q.type === 'short_answer'
            ? {
                score: a.score === 1 ? 1 : 0,
                correct: a.score === 1,
                partial: false,
                blankResults: [a.score === 1],
              }
            : gradeAnswer(q, a.answer)),
        });
      }
    });
    d.settings = incoming.settings;
    this.rebuild(d);
    this.write(d);
  }
}

async function rpc(name: string, params: Record<string, unknown>) {
  const { data, error } = await supabase!.rpc(name, params);
  if (error) throw Error(error.message);
  return data;
}
export class SupabaseRepository implements Repository {
  async load(): Promise<AppData> {
    // A transactional snapshot avoids mixed statistics across multiple REST pages.
    return (await rpc('load_study_data', {})) as AppData;
  }
  async importBank(bank: QuestionBank): Promise<ImportResult> {
    return rpc('import_question_bank', { p_bank: bank });
  }
  async commitSession(session: StudySession, attempts: AttemptInput[] = []) {
    await rpc('commit_study_session', { p_session: session, p_attempts: attempts });
  }
  async updateQuestion(
    id: string,
    changes: { favorite?: boolean; archived?: boolean; report?: string },
  ) {
    const { error } = await supabase!.from('questions').update(changes).eq('key', id);
    if (error) throw Error(error.message);
  }
  async saveSettings(settings: Settings) {
    await rpc('save_study_settings', { p_settings: settings });
  }
  async manageSubject(
    action: 'addSubject' | 'deleteSubject' | 'addUnit' | 'deleteUnit',
    subject: string,
    unit = '',
  ) {
    await rpc('manage_study_subject', { p_action: action, p_subject: subject, p_unit: unit });
  }
  async restore(data: AppData) {
    await rpc('restore_study_backup', { p_data: validateBackup(data) });
  }
}
