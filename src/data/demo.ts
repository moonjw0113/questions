import { biology } from 'virtual:study-content';
import {
  type AppData,
  type Question,
  type QuestionBank,
  type InternalBank,
  defaultSettings,
} from '../domain/types';
import { normalizeBank } from '../domain/import';
import { scheduleReview } from '../domain/review';
import { gradeAnswer } from '../domain/grading';

export function demoData(): AppData {
  const bio = normalizeBank(biology as QuestionBank);
  const make = (
    id: string,
    subject: string,
    unit: string,
    topic: string,
    content: string,
    answers: string[],
  ): Question => ({
    id: `${subject === '국어' ? 'korean-01' : 'history-01'}::${id}`,
    sourceId: id,
    version: 1,
    subject,
    unit,
    topic,
    tags: [topic],
    type: 'short_answer',
    content,
    acceptedAnswers: answers,
    explanation: `모범답안은 ‘${answers[0]}’입니다. 질문의 핵심 개념을 연결해서 기억해 보세요.`,
    difficulty: 1,
    source: '차곡 체험용 예시',
    createdAt: '2026-10-01T00:00:00Z',
  });
  const banks: InternalBank[] = [
    bio,
    {
      bank: { id: 'korean-01', title: '국어 · 문학의 표현', subject: '국어', unit: '문학의 표현' },
      questions: [
        make(
          'kor-001',
          '국어',
          '문학의 표현',
          '비유법',
          '‘내 마음은 호수요’처럼 원관념과 보조 관념을 동일시하는 비유법은?',
          ['은유법', '은유'],
        ),
        make(
          'kor-002',
          '국어',
          '문학의 표현',
          '비유법',
          '사람이 아닌 대상에 사람의 성질을 부여하여 표현하는 방법은?',
          ['의인법', '의인'],
        ),
        make(
          'kor-003',
          '국어',
          '문학의 표현',
          '직유법',
          '‘구름 같은 솜사탕’처럼 대상을 직접 빗대어 표현하는 방법은?',
          ['직유법', '직유'],
        ),
        make(
          'kor-004',
          '국어',
          '문학의 표현',
          '반어법',
          '실제 의도와 반대되는 말로 뜻을 강조하는 표현법은?',
          ['반어법', '반어'],
        ),
      ],
    },
    {
      bank: {
        id: 'history-01',
        title: '한국사 · 근대의 시작',
        subject: '한국사',
        unit: '근대 국가 수립 운동',
      },
      questions: [
        make(
          'his-001',
          '한국사',
          '근대 국가 수립 운동',
          '개항',
          '1876년 조선이 일본과 맺은 최초의 근대적 조약은?',
          ['강화도 조약', '조일 수호 조규'],
        ),
        make(
          'his-002',
          '한국사',
          '근대 국가 수립 운동',
          '갑신정변',
          '1884년 급진 개화파가 일으킨 정변은?',
          ['갑신정변'],
        ),
        make(
          'his-003',
          '한국사',
          '근대 국가 수립 운동',
          '동학 농민 운동',
          '1894년 동학 농민군이 전주 화약 이후 설치한 자치 기구는?',
          ['집강소'],
        ),
        make(
          'his-004',
          '한국사',
          '근대 국가 수립 운동',
          '독립 협회',
          '1896년 서재필 등이 창립하여 독립문 건립과 민권 신장 운동을 펼친 단체는?',
          ['독립 협회', '독립협회'],
        ),
      ],
    },
  ];
  const d: AppData = {
    subjects: [],
    banks: [],
    entries: [],
    versions: [],
    sessions: [],
    attempts: [],
    progress: [],
    settings: { ...defaultSettings },
  };
  banks.forEach((b) => {
    d.banks.push({ ...b.bank, createdAt: b.questions[0].createdAt });
    d.subjects.push({ name: b.bank.subject, units: [...new Set(b.questions.map((q) => q.unit))] });
    b.questions.forEach((q) => {
      d.versions.push({ bankId: b.bank.id, question: q });
      d.entries.push({
        id: q.id,
        bankId: b.bank.id,
        currentVersion: 1,
        favorite: ['bio-002', 'his-001'].includes(q.sourceId),
        archived: false,
        report: '',
      });
    });
  });
  // Demo records are explicitly labelled in the UI and never sent to Supabase.
  for (let day = 5; day >= 0; day--) {
    const at = new Date(Date.now() - day * 86400000 - 3600000).toISOString();
    const sessionId = crypto.randomUUID();
    const qs = d.versions.slice(day % 4, (day % 4) + 5).map((v) => v.question);
    const session: AppData['sessions'][number] = {
      id: sessionId,
      mode: day % 2 ? 'review' : 'learn',
      status: 'completed',
      queue: qs.map((q) => ({ id: q.id, version: 1 })),
      index: qs.length,
      answers: {},
      durations: {},
      choiceOrders: {},
      startedAt: at,
      updatedAt: at,
      completedAt: at,
      revision: 1,
    };
    qs.forEach((q, i) => {
      const right = (day + i) % 4 !== 0;
      const answer = !right
        ? ['잘 모르겠어요']
        : q.type === 'multiple_choice'
          ? [q.correctOptionId]
          : q.type === 'short_answer'
            ? [q.acceptedAnswers[0]]
            : q.blanks.map((b) => b.acceptedAnswers[0]);
      session.answers[`${q.id}@1`] = answer;
      const grade = gradeAnswer(q, answer);
      const p = scheduleReview(
        d.progress.find((p) => p.questionId === q.id),
        grade.score,
        at,
        'standard',
        q.id,
      );
      d.progress = [...d.progress.filter((p) => p.questionId !== q.id), p];
      d.attempts.push({
        id: crypto.randomUUID(),
        sessionId,
        questionId: q.id,
        questionVersion: 1,
        answer,
        ...grade,
        answeredAt: at,
        mode: session.mode,
        durationMs: 24000 + i * 13000,
        attemptNumber: p.totalAttempts,
        manual: false,
      });
    });
    d.sessions.push(session);
  }
  return d;
}
