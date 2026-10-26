import {
  ArrowUpRight,
  ArrowRight,
  BookOpen,
  RotateCcw,
  Target,
  Flame,
  Sparkles,
  Plus,
  Leaf,
  Check,
  CalendarDays,
  Play,
  Sprout,
  GraduationCap,
  FolderOpen,
} from 'lucide-react';
import { useApp } from '../state/AppContext';
import { currentQuestions } from '../domain/types';
import { getStats, percentage } from '../domain/statistics';
import { Progress, SectionTitle, TextLink, subjectColor } from '../components/ui';
export function Home({
  navigate,
  start,
  upload,
  resume,
}: {
  navigate: (page: string) => void;
  start: (subject?: string, review?: boolean) => void;
  upload: () => void;
  resume: (id: string) => void;
}) {
  const { data: d, demo } = useApp();
  if (!d) return null;
  const stats = getStats(d),
    questions = currentQuestions(d),
    goal = d.settings.dailyGoal,
    percent = Math.min(100, Math.round((stats.today / goal) * 100));
  const active = d.sessions
    .filter((s) => s.status === 'active')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const date = new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    timeZone: 'Asia/Seoul',
  }).format(new Date());
  const recent = d.attempts
    .slice()
    .sort((a, b) => b.answeredAt.localeCompare(a.answeredAt))
    .slice(0, 3);
  return (
    <div className="page home-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="tiny-dot" />
            조금씩, 꾸준히, 내 것으로
          </div>
          <h1>
            오늘도 차곡차곡 쌓아 볼까요?<span className="wave">✳</span>
          </h1>
          <p>작은 반복이 큰 자신감이 돼요. 오늘의 공부를 시작해 보세요.</p>
        </div>
        <span className="date-chip">
          <CalendarDays size={15} />
          {date}
        </span>
      </div>
      {active && (
        <button className="resume-banner" onClick={() => resume(active.id)}>
          <Play size={17} />
          <strong>하던 공부를 이어 가세요</strong>
          <span>
            {Math.min(active.index + 1, active.queue.length)} / {active.queue.length}문제
          </span>
          <ArrowRight size={18} />
        </button>
      )}
      <div className="hero-grid">
        <section className="today-hero">
          <div className="hero-copy">
            <span className="hero-tag">
              <Leaf size={14} />
              TODAY'S STUDY
            </span>
            <h2>
              오늘의 작은 공부,
              <br />
              내일의 확실한 기억.
            </h2>
            <p>
              {stats.today >= goal
                ? '오늘의 목표를 달성했어요! 멋진 하루예요.'
                : '하루 ' + goal + '문제, 나를 위한 좋은 습관을 만들어요.'}
            </p>
            <button className="button cream" onClick={() => start()}>
              학습 시작하기
              <ArrowRight size={18} />
            </button>
          </div>
          <div
            className="goal-ring"
            style={{ '--ring-progress': `${percent}%` } as React.CSSProperties}
          >
            <div>
              <span>오늘의 목표</span>
              <strong>
                {stats.today}
                <small> / {goal}</small>
              </strong>
              <span className="ring-bottom">
                {percent >= 100 ? (
                  <>
                    <Check size={13} />
                    목표 달성
                  </>
                ) : (
                  <>{percent}% 달성했어요</>
                )}
              </span>
            </div>
          </div>
          <span className="hero-orbit orbit-one" />
          <span className="hero-orbit orbit-two" />
        </section>
        <section className="review-card">
          <div className="review-icon">
            <RotateCcw size={23} />
            <span className="icon-spark">✦</span>
          </div>
          <span className="eyebrow">잊기 전에 한 번 더</span>
          <h3>오늘의 복습</h3>
          <div className="review-number">
            {stats.due}
            <span>문제</span>
          </div>
          <p>
            기억이 흐려지기 전에 다시 만나면
            <br />더 오래 기억할 수 있어요.
          </p>
          <button className="button secondary full" onClick={() => start(undefined, true)}>
            복습하러 가기
            <ArrowRight size={17} />
          </button>
        </section>
      </div>
      <div className="metric-grid">
        <div className="metric">
          <span className="metric-icon green">
            <BookOpen size={20} />
          </span>
          <div>
            <span>나의 문제은행</span>
            <strong>
              {questions.length}
              <small>문제</small>
            </strong>
          </div>
          <span className="metric-note">{d.banks.length}개의 문제은행</span>
        </div>
        <div className="metric">
          <span className="metric-icon blue">
            <Target size={20} />
          </span>
          <div>
            <span>최근 정답률</span>
            <strong>
              {stats.recentAccuracy}
              <small>%</small>
            </strong>
          </div>
          <span className="metric-note positive">
            최근 30회 기준 <ArrowUpRight size={13} />
          </span>
        </div>
        <div className="metric">
          <span className="metric-icon orange">
            <Flame size={20} />
          </span>
          <div>
            <span>연속 학습</span>
            <strong>
              {stats.streak}
              <small>일째</small>
            </strong>
          </div>
          <span className="metric-note">좋은 습관을 쌓는 중</span>
        </div>
      </div>
      <div className="dashboard-lower">
        <section className="subject-section">
          <SectionTitle
            title="나의 과목"
            subtitle="한 과목씩, 차근차근 완성해요"
            action={<TextLink onClick={() => navigate('bank')}>전체 보기</TextLink>}
          />
          <div className="subject-grid">
            {d.subjects.map((s, i) => {
              const qs = questions.filter((q) => q.subject === s.name),
                learned = qs.filter((q) => d.progress.some((p) => p.questionId === q.id)).length;
              const attempts = d.attempts.filter((a) =>
                d.versions.some(
                  (v) =>
                    v.question.id === a.questionId &&
                    v.question.version === a.questionVersion &&
                    v.question.subject === s.name,
                ),
              );
              const color = subjectColor(s.name);
              return (
                <button className="subject-card" key={s.name} onClick={() => start(s.name)}>
                  <div className="subject-card-top">
                    <span className={`subject-icon ${color}`}>
                      {i % 3 === 0 ? (
                        <Leaf size={23} />
                      ) : i % 3 === 1 ? (
                        <BookOpen size={23} />
                      ) : (
                        <GraduationCap size={23} />
                      )}
                    </span>
                    <ArrowUpRight size={17} />
                  </div>
                  <h3>{s.name}</h3>
                  <p>
                    {s.units.length}개 단원 <span>·</span> {qs.length}문제
                  </p>
                  <div className="subject-card-detail">
                    <span>학습 진행률</span>
                    <strong>{qs.length ? Math.round((learned / qs.length) * 100) : 0}%</strong>
                  </div>
                  <Progress value={qs.length ? (learned / qs.length) * 100 : 0} className={color} />
                  <div className="subject-card-footer">
                    <span>
                      정답률 <b>{percentage(attempts.map((a) => a.score))}%</b>
                    </span>
                    <span>
                      이어서 학습 <ArrowRight size={12} />
                    </span>
                  </div>
                </button>
              );
            })}
            <button className="add-subject-card" onClick={() => navigate('settings')}>
              <span>
                <Plus size={22} />
              </span>
              <strong>새 과목 추가</strong>
              <small>나만의 학습 공간을 넓혀 보세요</small>
            </button>
          </div>
        </section>
        <section className="weekly-panel panel">
          <SectionTitle
            title="이번 주의 발자국"
            action={
              <span className="subtle-icon">
                <CalendarDays size={17} />
              </span>
            }
          />
          <p className="weekly-sub">꾸준히 쌓인 공부가 실력이 돼요.</p>
          <div className="weekly-total">
            <strong>{stats.days.reduce((s, d) => s + d.count, 0)}</strong>
            <span>문제 풀었어요</span>
            <span className="week-label">최근 7일</span>
          </div>
          <div className="weekly-chart" aria-label="최근 7일 학습량">
            {stats.days.map((day, i) => (
              <div key={day.date} className={i === 6 ? 'today' : ''}>
                <div className="bar-space">
                  <span
                    className="bar"
                    style={{
                      height: `${Math.max(4, (day.count / Math.max(1, ...stats.days.map((d) => d.count))) * 88)}px`,
                    }}
                    title={`${day.date}: ${day.count}문제`}
                  />
                </div>
                <span>{day.label}</span>
                <small>{day.count}</small>
              </div>
            ))}
          </div>
          <div className="weekly-footer">
            <Flame size={16} />
            <span>
              <strong>{stats.streak}일 연속</strong> 좋은 습관을 만드는 중이에요.
            </span>
          </div>
        </section>
      </div>
      <div className="bottom-grid">
        <section className="recent-panel panel">
          <SectionTitle
            title="최근 학습"
            action={<TextLink onClick={() => navigate('stats')}>학습 기록</TextLink>}
          />
          {recent.length ? (
            recent.map((a) => {
              const q = d.versions.find(
                (v) => v.question.id === a.questionId && v.question.version === a.questionVersion,
              )?.question;
              return (
                <div className="recent-row" key={a.id}>
                  <span className={`mini-subject ${subjectColor(q?.subject || '')}`}>
                    <FolderOpen size={18} />
                  </span>
                  <div>
                    <strong>
                      {q?.subject} <span>·</span> {q?.topic}
                    </strong>
                    <small>
                      {new Intl.DateTimeFormat('ko-KR', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Asia/Seoul',
                      }).format(new Date(a.answeredAt))}
                    </small>
                  </div>
                  <span className={`badge ${a.correct ? 'green' : a.partial ? 'orange' : 'red'}`}>
                    {a.correct ? '정답' : a.partial ? '부분 정답' : '다시 복습'}
                  </span>
                </div>
              );
            })
          ) : (
            <p className="muted padded">첫 문제를 풀고 공부의 첫 발자국을 남겨 보세요.</p>
          )}
        </section>
        <button className="import-promo" onClick={upload}>
          <span className="promo-icon">
            <Sparkles size={24} />
          </span>
          <div>
            <span className="eyebrow">나에게 꼭 맞는 문제로</span>
            <h3>
              ChatGPT에서 만든 문제,
              <br />
              차곡에 가져오세요.
            </h3>
            <p>JSON 파일 하나로 나만의 문제은행 완성.</p>
            <span className="text-link">
              문제 가져오기
              <ArrowRight size={16} />
            </span>
          </div>
          <span className="promo-decoration">+</span>
        </button>
      </div>
      <footer className="page-footer">
        <Sprout size={14} />
        <span>조금씩 쌓이는 오늘이, 단단한 내일을 만들어요.</span>
        {demo && <small>표시된 기록은 체험용 예시입니다.</small>}
      </footer>
    </div>
  );
}
