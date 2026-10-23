// 화면 오류가 나도 흰 화면 대신 오류 내용과 복구 버튼을 보여 준다
import { Component, type ReactNode } from 'react';
import { reloadFresh } from '../lib/recover.ts';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    return (
      <div style={{ padding: 20, fontSize: 17, lineHeight: 1.5 }}>
        <h2 style={{ color: '#b91c1c' }}>화면을 여는 중 문제가 생겼습니다</h2>
        <p>입력한 데이터는 지워지지 않았습니다. 아래 버튼을 차례로 눌러 보세요.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '16px 0' }}>
          <button style={{ minHeight: 52, fontSize: 18 }} onClick={() => location.reload()}>1. 새로고침</button>
          <button style={{ minHeight: 52, fontSize: 18, background: '#b91c1c', color: '#fff', border: 0, borderRadius: 10 }} onClick={() => void reloadFresh()}>2. 앱 다시 받기 (데이터 유지)</button>
          <button style={{ minHeight: 52, fontSize: 18 }} onClick={() => { location.href = '/'; }}>3. 처음 화면으로</button>
        </div>
        <p style={{ color: '#666', fontSize: 14 }}>계속 안 되면 이 화면을 캡처해서 보내 주세요.</p>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#f3f4f6', padding: 10, borderRadius: 8 }}>
          {e.message}
          {'\n'}
          {(e.stack ?? '').split('\n').slice(0, 6).join('\n')}
        </pre>
      </div>
    );
  }
}
