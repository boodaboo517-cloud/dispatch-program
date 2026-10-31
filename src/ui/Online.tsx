// 접속 중 표시: "🟢 접속 중 N명" → 누르면 목록 (아이디 · 접속 시작 · 보는 화면 · 기기)
import { TZ, dayjs } from '../lib/time.ts';
import { useStore } from './hooks.ts';
import { Sheet, useSheet } from './Sheet.tsx';

/** 주소 → 화면 이름 */
export function screenName(path: string, search = ''): string {
  const date = new URLSearchParams(search).get('date');
  const d = date ? ` ${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` : '';
  if (path === '/') return `배차${d}`;
  if (path === '/all') return `일정표${d}`;
  if (path === '/order') return '오더 입력';
  if (path.startsWith('/clients')) return '거래처';
  if (path.startsWith('/products')) return '품목';
  if (path === '/fleet/vehicles') return '차량';
  if (path === '/fleet/drivers') return '기사';
  if (path === '/fleet/attendance') return '근무현황';
  if (path === '/fleet/ships') return '선박';
  if (path === '/fleet/field') return '현장';
  if (path === '/history') return '수정 이력';
  if (path === '/users') return '사용자 관리';
  if (path === '/revenue') return '매출';
  if (path.startsWith('/admin')) return '관리 현황';
  if (path === '/settings') return '설정';
  if (path === '/driver') return '내 배차';
  return path;
}

/** 같은 사람이 여러 창을 열어도 사람 수는 한 번만 */
const peopleCount = (list: { user_id: string }[]) => new Set(list.map((u) => u.user_id)).size;

/** 접속 중 표시는 관리자만 (배차 담당·기사에게는 안 보임) */
export function OnlineBadge() {
  const list = useStore((s) => s.onlineUsers);
  const admin = useStore((s) => s.session?.role === 'admin');
  const sheet = useSheet();
  if (!admin || !list.length) return null;
  return (
    <button className="online-badge" onClick={() => sheet.open((close) => <OnlineSheet close={close} />)} title="지금 접속 중인 사람">
      <span className="online-dot" /> 접속 중 {peopleCount(list)}명
    </button>
  );
}

function OnlineSheet({ close }: { close: () => void }) {
  const list = useStore((s) => s.onlineUsers);
  const snap = useStore((s) => s.snap);
  const me = useStore((s) => s.session?.userId);
  const editingText = (id: string | null) => {
    if (!id) return '';
    const o = snap.daily_orders.find((x) => x.id === id);
    if (o) return `오더 ${Number(o.date.slice(5, 7))}/${Number(o.date.slice(8, 10))}`;
    const vd = snap.vehicle_days.find((x) => x.id === id);
    if (vd) return `차량 ${snap.vehicles.find((v) => v.id === vd.vehicle_id)?.short_no ?? ''} ${Number(vd.date.slice(5, 7))}/${Number(vd.date.slice(8, 10))}`;
    return '편집 중';
  };
  return (
    <Sheet title={`접속 중 ${peopleCount(list)}명`} onClose={close} footer={<button className="primary" onClick={close}>닫기</button>}>
      <p className="muted small">창을 닫거나 1분 넘게 응답이 없으면 목록에서 빠집니다. 같은 사람이 PC·폰을 같이 켜면 두 줄로 보입니다.</p>
      <table className="simple" style={{ width: '100%' }}>
        <thead><tr><th>아이디</th><th>접속 시작</th><th>보는 화면</th><th>기기</th></tr></thead>
        <tbody>
          {list.map((u) => (
            <tr key={u.key}>
              <td><b>{u.login_id || u.name}</b>{u.login_id && u.name && u.name !== u.login_id ? <span className="muted small"> {u.name}</span> : null}{u.user_id === me && <span className="muted small"> (나)</span>}</td>
              <td>{dayjs(u.since).tz(TZ).format('HH:mm')}</td>
              <td>{u.tab}{u.editing && <div className="small" style={{ color: '#2563eb' }}>✏ {editingText(u.editing)}</div>}</td>
              <td>{u.device}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Sheet>
  );
}
