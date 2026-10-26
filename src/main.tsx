import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppProvider } from './state/AppContext';
import { App } from './App';
import './styles.css';
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="empty">
        <h1>화면을 불러오지 못했어요.</h1>
        <p>저장된 학습 기록은 유지됩니다. 새로고침 후 다시 시도해 주세요.</p>
        <button className="button primary" onClick={() => location.reload()}>
          새로고침
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
// Reuse the root if the entry module is reevaluated during development HMR.
const root = import.meta.hot?.data.root || ReactDOM.createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppProvider>
        <App />
      </AppProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
