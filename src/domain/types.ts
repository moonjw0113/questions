export type QuestionType = 'multiple_choice' | 'short_answer' | 'fill_blank';
export type StudyMode = 'learn' | 'review' | 'exam';
export type Difficulty = 1 | 2 | 3;
export interface QuestionBase {
  id: string;
  sourceId: string;
  version: number;
  subject: string;
  unit: string;
  topic: string;
  tags: string[];
  content: string;
  explanation: string;
  difficulty: Difficulty;
  source: string;
  createdAt: string;
}
export interface Choice {
  id: string;
  text: string;
}
export type Question = QuestionBase &
  (
    | { type: 'multiple_choice'; options: Choice[]; correctOptionId: string }
    | { type: 'short_answer'; acceptedAnswers: string[] }
    | { type: 'fill_blank'; blanks: { id: string; acceptedAnswers: string[] }[] }
  );
export type ImportQuestion = {
  id: string;
  topic: string;
  difficulty: Difficulty;
  prompt: string;
  explanation: string;
  tags: string[];
} & (
  | { type: 'multiple_choice'; options: Choice[]; answer: { option_id: string } }
  | { type: 'short_answer'; answer: { accepted: string[] } }
  | { type: 'fill_blank'; answer: { blanks: { id: string; accepted: string[] }[] } }
);
export interface QuestionBank {
  schema_version: '1.0';
  bank: { id: string; title: string; subject: string; unit: string };
  questions: ImportQuestion[];
}
export interface InternalBank {
  bank: QuestionBank['bank'];
  questions: Question[];
}
export interface QuestionEntry {
  id: string;
  dbId?: string;
  bankId: string;
  currentVersion: number;
  favorite: boolean;
  archived: boolean;
  report: string;
}
export interface VersionEntry {
  bankId: string;
  question: Question;
}
export interface Subject {
  name: string;
  units: string[];
}
export interface BankInfo {
  id: string;
  title: string;
  subject: string;
  unit: string;
  createdAt: string;
}
export interface Grade {
  score: number;
  correct: boolean;
  partial: boolean;
  blankResults: boolean[];
}
export interface Attempt extends Grade {
  id: string;
  sessionId: string;
  questionId: string;
  questionVersion: number;
  answer: string[];
  durationMs: number;
  mode: StudyMode;
  answeredAt: string;
  attemptNumber: number;
  manual: boolean;
  reviewPace?: Settings['reviewPace'];
}
export interface ReviewProgress {
  questionId: string;
  repetitions: number;
  interval: number;
  ease: number;
  mastery: number;
  nextDue: string;
  totalAttempts: number;
  correctCount: number;
  recentScores: number[];
}
export interface QuestionRef {
  id: string;
  version: number;
}
export interface StudySession {
  id: string;
  mode: StudyMode;
  status: 'active' | 'completed';
  queue: QuestionRef[];
  index: number;
  answers: Record<string, string[]>;
  choiceOrders: Record<string, string[]>;
  durations: Record<string, number>;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  revision: number;
}
export interface Settings {
  theme: 'light' | 'dark' | 'system';
  dailyGoal: number;
  reviewPace: 'standard' | 'gentle' | 'intensive';
  shuffleQuestions: boolean;
  shuffleChoices: boolean;
}
export const defaultSettings: Settings = {
  theme: 'light',
  dailyGoal: 20,
  reviewPace: 'standard',
  shuffleQuestions: true,
  shuffleChoices: true,
};
export interface AppData {
  subjects: Subject[];
  banks: BankInfo[];
  entries: QuestionEntry[];
  versions: VersionEntry[];
  sessions: StudySession[];
  attempts: Attempt[];
  progress: ReviewProgress[];
  settings: Settings;
}
export interface AttemptInput {
  id: string;
  questionId: string;
  questionVersion: number;
  answer: string[];
  durationMs: number;
  manualScore?: 0 | 1;
}
export interface Filters {
  subject: string;
  unit: string;
  type: string;
  difficulty: string;
  scope: 'all' | 'wrong' | 'due' | 'favorite';
  search: string;
}
export const emptyFilters: Filters = {
  subject: '',
  unit: '',
  type: '',
  difficulty: '',
  scope: 'all',
  search: '',
};
export const typeLabels: Record<QuestionType, string> = {
  multiple_choice: '객관식',
  short_answer: '단답형',
  fill_blank: '빈칸 채우기',
};
export const modeLabels: Record<StudyMode, string> = {
  learn: '일반 학습',
  review: '집중 복습',
  exam: '실전 시험',
};
export const questionKey = (q: QuestionRef) => `${q.id}@${q.version}`;
export const currentQuestions = (d: AppData) =>
  d.entries
    .filter((e) => !e.archived)
    .flatMap((e) => {
      const v = d.versions.find(
        (v) => v.question.id === e.id && v.question.version === e.currentVersion,
      );
      return v ? [v.question] : [];
    });
export const getQuestion = (d: AppData, ref: QuestionRef) =>
  d.versions.find((v) => v.question.id === ref.id && v.question.version === ref.version)?.question;
