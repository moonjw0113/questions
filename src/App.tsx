import { useEffect, useState, type FormEvent } from 'react';
import {
  Layers,
  House,
  BookOpen,
  LibraryBig,
  ChartNoAxesCombined,
  Settings2,
  Plus,
  Search,
  Sprout,
  ArrowUpRight,
  Cloud,
  WifiOff,
  CheckCircle2,
  AlertCircle,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import { registerSW } from 'virtual:pwa-register';
import { useApp } from './state/AppContext';
import { Home } from './pages/Home';
import { Study } from './pages/Study';
import { Bank } from './pages/Bank';
import { Statistics } from './pages/Statistics';
import { Settings } from './pages/Settings';
import { Player } from './pages/Player';
import { Auth } from './pages/Auth';
import { ImportModal } from './components/ImportModal';
import { ExportModal } from './components/ExportModal';
import { Empty } from './components/ui';
import { downloadJson } from './domain/statistics';
const items = [
  { id: 'home', label: '홈', icon: House },
  { id: 'study', label: '학습', icon: BookOpen },
  { id: 'bank', label: '문제은행', icon: LibraryBig },
  { id: 'stats', label: '통계', icon: ChartNoAxesCombined },
  { id: 'settings', label: '설정', icon: Settings2 },
];
export function App() {
  const { data, loading, demo, user, message, busy, refresh, notify, leaveDemo } = useApp();
  const [route, setRoute] = useState(location.hash.slice(1) || 'home'),
    [modal, setModal] = useState<'import' | 'export' | null>(null),
    [search, setSearch] = useState(''),
    [bankSearch, setBankSearch] = useState(''),
    [studyInit, setStudyInit] = useState({ subject: '', review: false, nonce: 0 }),
    [online, setOnline] = useState(navigator.onLine),
    [update, setUpdate] = useState<null | (() => Promise<void>)>(null);
  useEffect(() => {
    const change = () => setRoute(location.hash.slice(1) || 'home');
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    const on = () => setOnline(true),
      off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  useEffect(() => {
    const theme = data?.settings.theme || 'light',
      media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [data?.settings.theme]);
  useEffect(() => {
    const updateSW = registerSW({
      onNeedRefresh() {
        setUpdate(() => async () => {
          await updateSW(true);
        });
      },
      onRegisterError() {
        /* Network failures are handled by the online status. */
      },
    });
  }, []);
  function navigate(page: string) {
    location.hash = page;
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function start(subject = '', review = false) {
    setStudyInit({ subject, review, nonce: Date.now() });
    navigate('study');
  }
  function searchQuestions(e: FormEvent) {
    e.preventDefault();
    setBankSearch(search);
    navigate('bank');
  }
  const toast = message && (
    <div
      className={`toast ${message.error ? 'error' : ''}`}
      role={message.error ? 'alert' : 'status'}
    >
      {message.error ? <AlertCircle size={19} /> : <CheckCircle2 size={19} />}
      <span>{message.text}</span>
    </div>
  );
  if (loading)
    return (
      <div className="app-loading">
        <span className="brand-icon">
          <Layers size={28} />
        </span>
        <h1>차곡</h1>
        <LoaderCircle className="spin" size={23} />
        <p>나의 공부를 불러오고 있어요.</p>
        {toast}
      </div>
    );
  if (!demo && !user)
    return (
      <>
        <Auth />
        {toast}
      </>
    );
  if (!data)
    return (
      <>
        <Empty
          title="학습 데이터를 불러오지 못했어요"
          description={
            demo
              ? '저장된 체험 기록을 보존하고 있습니다. 복구용 원본을 다운로드해 주세요.'
              : 'Supabase 초기 SQL과 연결 설정, 네트워크 상태를 확인해 주세요.'
          }
          action={
            <div className="results-actions">
              <button
                className="button primary"
                onClick={() => void refresh().catch((e) => notify(e.message, true))}
              >
                <RefreshCw size={17} />
                다시 시도
              </button>
              {demo && (
                <button
                  className="button secondary"
                  onClick={() =>
                    downloadJson(
                      { type: 'chagok_recovery', raw: localStorage.getItem('chagok-demo-v1') },
                      'chagok_recovery.json',
                    )
                  }
                >
                  복구용 원본 다운로드
                </button>
              )}
            </div>
          }
        />
        {toast}
      </>
    );
  const sessionId = route.startsWith('session/') ? route.slice(8) : null;
  return (
    <>
      {sessionId ? (
        <Player
          id={sessionId}
          onExit={() => navigate('study')}
          onStart={(id) => navigate(`session/${id}`)}
        />
      ) : (
        <div className="app-shell">
          <aside className="sidebar">
            <button className="brand" onClick={() => navigate('home')} aria-label="차곡 홈">
              <span className="brand-icon">
                <Layers size={24} />
              </span>
              <span>
                차곡<small>매일 쌓이는 나의 공부</small>
              </span>
            </button>
            <span className="nav-caption">나의 학습 공간</span>
            <nav aria-label="주 메뉴">
              {items.map((i) => (
                <button
                  key={i.id}
                  className={`nav-item ${route === i.id ? 'active' : ''}`}
                  onClick={() => navigate(i.id)}
                >
                  <i.icon size={20} />
                  <span>{i.label}</span>
                  {route === i.id && <span className="nav-dot" />}
                </button>
              ))}
            </nav>
            <button className="sidebar-import" onClick={() => setModal('import')}>
              <Plus size={18} />
              문제 가져오기
            </button>
            <div className="sidebar-bottom">
              <div className="sidebar-note">
                <Sprout size={26} />
                <strong>
                  오늘의 작은 반복이
                  <br />
                  내일의 자신감으로.
                </strong>
                <p>나만의 속도로, 꾸준히.</p>
                <span>KEEP GROWING</span>
              </div>
              <button className="sidebar-profile" onClick={() => navigate('settings')}>
                <span className="avatar">
                  {demo ? '체' : user?.email?.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{demo ? '체험 학습자' : user?.email?.split('@')[0]}</strong>
                  <small>{demo ? '차곡과 함께 시작해요' : '나의 학습 계정'}</small>
                </span>
                <Settings2 size={17} />
              </button>
            </div>
          </aside>
          <div className="main-shell">
            <header className="topbar">
              <div className="breadcrumbs">
                나의 학습 공간<span>/</span>
                <strong>{items.find((i) => i.id === route)?.label || '홈'}</strong>
              </div>
              <span className="mobile-brand">
                <Layers size={20} />
                차곡
              </span>
              <form className="top-search" onSubmit={searchQuestions}>
                <Search size={17} />
                <input
                  aria-label="전체 문제 검색"
                  placeholder="어떤 개념을 찾고 있나요?"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <kbd>↵</kbd>
              </form>
              <div className="topbar-right">
                <span className={`sync-status ${!online ? 'offline' : ''}`}>
                  {busy ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : !online ? (
                    <WifiOff size={14} />
                  ) : demo ? (
                    <span className="tiny-dot" />
                  ) : (
                    <Cloud size={15} />
                  )}
                  <span>
                    {busy ? '저장 중' : !online ? '오프라인' : demo ? '체험 모드' : '클라우드 연결'}
                  </span>
                </span>
                <button
                  className="avatar small-avatar"
                  aria-label="계정 설정"
                  onClick={() => navigate('settings')}
                >
                  {demo ? '체' : user?.email?.slice(0, 1).toUpperCase()}
                </button>
              </div>
            </header>
            {demo && (
              <div className="demo-strip">
                <span>지금은 체험 모드예요. 예시 문제와 기록으로 자유롭게 둘러보세요.</span>
                <button onClick={leaveDemo}>
                  내 계정으로 시작하기
                  <ArrowUpRight size={13} />
                </button>
              </div>
            )}
            {!online && (
              <div className="offline-banner" role="status">
                <WifiOff size={16} />
                {demo
                  ? '체험 데이터는 이 기기에 저장돼요.'
                  : '인터넷 연결이 끊겼어요. 연결 후 저장을 다시 시도해 주세요.'}
              </div>
            )}
            {route === 'study' ? (
              <Study
                key={studyInit.nonce}
                initialSubject={studyInit.subject}
                initialReview={studyInit.review}
                onStart={(id) => navigate(`session/${id}`)}
                upload={() => setModal('import')}
              />
            ) : route === 'bank' ? (
              <Bank key={bankSearch} initialSearch={bankSearch} upload={() => setModal('import')} />
            ) : route === 'stats' ? (
              <Statistics exportResults={() => setModal('export')} start={start} />
            ) : route === 'settings' ? (
              <Settings exportResults={() => setModal('export')} />
            ) : (
              <Home
                navigate={navigate}
                start={start}
                upload={() => setModal('import')}
                resume={(id) => navigate(`session/${id}`)}
              />
            )}
          </div>
          <nav className="bottom-nav" aria-label="하단 메뉴">
            {items.map((i) => (
              <button
                key={i.id}
                className={route === i.id ? 'active' : ''}
                onClick={() => navigate(i.id)}
              >
                <i.icon size={21} />
                <span>{i.label}</span>
              </button>
            ))}
          </nav>
        </div>
      )}
      {modal === 'import' && <ImportModal onClose={() => setModal(null)} />}
      {modal === 'export' && <ExportModal onClose={() => setModal(null)} />}
      {toast}
      {update && (
        <div className="update-notice">
          <span>새 버전이 준비됐어요. 진행 중인 학습을 저장한 뒤 업데이트해 주세요.</span>
          <button className="button secondary" onClick={() => void update()}>
            업데이트
          </button>
          <button
            className="icon-button"
            aria-label="나중에 업데이트"
            onClick={() => setUpdate(null)}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
