import { useState, type FormEvent } from 'react';
import { Layers, ArrowRight, Mail, Lock, Sprout } from 'lucide-react';
import { configured, supabase } from '../data/supabase';
import { useApp } from '../state/AppContext';
export function Auth() {
  const { enterDemo, notify } = useApp();
  const [signup, setSignup] = useState(false),
    [busy, setBusy] = useState(false),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) {
      notify('먼저 .env에 Supabase 공개 연결 정보를 설정해 주세요.', true);
      return;
    }
    setBusy(true);
    try {
      const result = signup
        ? await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: new URL(import.meta.env.BASE_URL, location.origin).href },
          })
        : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (signup && !result.data.session)
        notify('가입 확인 메일을 보냈습니다. 이메일의 링크를 누른 뒤 로그인해 주세요.');
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-story">
        <div className="brand">
          <span className="brand-icon">
            <Layers size={26} />
          </span>
          차곡<span className="brand-caption">매일 쌓이는 나의 공부</span>
        </div>
        <div className="auth-copy">
          <span className="eyebrow">A LITTLE EVERY DAY</span>
          <h1>
            작은 반복이
            <br />
            확실한 기억이 되도록.
          </h1>
          <p>
            나만의 문제를 풀고, 잊기 전에 복습하고.
            <br />
            오늘의 공부를 차곡차곡 쌓아 보세요.
          </p>
          <div className="plant-art">
            <Sprout size={130} strokeWidth={1} />
            <span>오늘도 한 뼘 자랐어요.</span>
          </div>
        </div>
        <small>내일의 나를 위한, 오늘의 작은 공부.</small>
      </div>
      <main className="auth-form">
        <div className="auth-card">
          <span className="eyebrow">WELCOME TO CHAGOK</span>
          <h2>{signup ? '공부의 첫 장을 열어 볼까요?' : '다시 만나 반가워요.'}</h2>
          <p>이메일로 로그인하고 공부를 이어 가세요.</p>
          <form onSubmit={submit}>
            <label>
              이메일
              <div className="input-icon">
                <Mail size={18} />
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
            </label>
            <label>
              비밀번호
              <div className="input-icon">
                <Lock size={18} />
                <input
                  type="password"
                  autoComplete={signup ? 'new-password' : 'current-password'}
                  required
                  minLength={signup ? 8 : 1}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="8자 이상 입력해 주세요"
                />
              </div>
            </label>
            <button className="button primary full" disabled={busy || !configured}>
              {busy ? '잠시만 기다려 주세요…' : signup ? '회원가입' : '로그인'}
              <ArrowRight size={18} />
            </button>
          </form>
          <button className="text-link auth-switch" onClick={() => setSignup(!signup)}>
            {signup ? '이미 계정이 있어요 · 로그인' : '처음 오셨나요? 회원가입'}
          </button>
          <div className="divider">먼저 둘러보고 싶다면</div>
          <button className="button secondary full" onClick={enterDemo}>
            체험 모드로 시작하기
          </button>
          <small className="muted">체험 데이터는 이 브라우저에만 저장됩니다.</small>
          {!configured && (
            <div className="notice">
              Supabase 연결 전입니다. README에 따라 환경변수를 설정하면 이메일 로그인을 사용할 수
              있어요.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
