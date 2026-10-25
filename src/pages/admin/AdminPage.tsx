// PC 관리 화면: 일별 배차현황 · 일일/월/기간별/거래처별 매출 · 직원·기사 근무현황 · 선박 이용현황 (모두 엑셀 받기)
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { addDays } from '../../domain/index.ts';
import { exportSchedule } from '../../excel/exportSchedule.ts';
import { exportReport, type ReportSheet } from '../../excel/exportReport.ts';
import { dayjs, seoulToday } from '../../lib/time.ts';
import { useRole, useSnap } from '../../ui/hooks.ts';
import { AttendancePanel } from '../AttendancePanel.tsx';
import { BillingPanel } from '../BillingPanel.tsx';
import { clientReport, dispatchReport, monthlyReport, revenueListReport, shipReport } from './reports.ts';

type Section = 'dispatch' | 'daily' | 'monthly' | 'period' | 'client' | 'billing' | 'attendance' | 'ships';
const MENU: [Section, string, string][] = [
  ['dispatch', '📋', '일별 배차현황'],
  ['daily', '💵', '일일 매출'],
  ['monthly', '📅', '월 매출'],
  ['period', '🗓', '기간별 매출'],
  ['client', '🏢', '거래처별 매출'],
  ['billing', '🧾', '업체별 청구'],
  ['attendance', '👷', '직원·기사 근무현황'],
  ['ships', '🚢', '선박 이용현황'],
];
const MONEY_SECTIONS: Section[] = ['daily', 'monthly', 'period', 'client', 'billing', 'ships'];

function Table({ sheet }: { sheet: ReportSheet }) {
  const all = sheet.totals ? [...sheet.rows, sheet.totals] : sheet.rows;
  const show = (v: unknown, num?: boolean) => (v == null || v === '' ? '' : num && typeof v === 'number' ? v.toLocaleString('ko-KR') : String(v));
  return (
    <div className="admin-table-wrap">
      <table className="simple admin-table">
        <thead><tr>{sheet.columns.map((c) => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>
          {all.map((r, i) => (
            <tr key={i} className={sheet.totals && i === all.length - 1 ? 'total' : ''}>
              {sheet.columns.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{show(r[c.key], c.num)}</td>)}
            </tr>
          ))}
          {!sheet.rows.length && <tr><td colSpan={sheet.columns.length} className="muted">자료 없음</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function AdminPage() {
  const { section = 'dispatch' } = useParams();
  const nav = useNavigate();
  const snap = useSnap();
  const { staff, admin } = useRole();
  // 매출·선박비 같은 금액 화면은 관리자만
  const menu = MENU.filter(([k]) => admin || !MONEY_SECTIONS.includes(k));
  const today = seoulToday();
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const sec = (menu.some(([k]) => k === section) ? section : 'dispatch') as Section;

  const data = useMemo(() => {
    if (sec === 'dispatch') return dispatchReport(snap, date);
    if (sec === 'daily') return { sheet: revenueListReport(snap, date, date, `일일 매출 ${dayjs(date).format('YYYY년 M월 D일 (dd)')}`) };
    if (sec === 'monthly') return { sheet: monthlyReport(snap, month) };
    if (sec === 'period') return { sheet: revenueListReport(snap, from, to, `기간별 매출 ${dayjs(from).format('M/D')} ~ ${dayjs(to).format('M/D')}`) };
    if (sec === 'client') return { sheet: clientReport(snap, from, to) };
    if (sec === 'ships') { const [a, b] = shipReport(snap, from, to); return { sheet: a, extra: b }; }
    return null;
  }, [snap, sec, date, month, from, to]);

  if (!staff) return <div className="page"><p>권한이 없습니다.</p></div>;

  const excel = () => {
    if (!data) return;
    const sheets = [data.sheet, ...('extra' in data && data.extra ? [data.extra] : [])];
    const stamp = sec === 'dispatch' || sec === 'daily' ? date : sec === 'monthly' ? month : `${from}_${to}`;
    void exportReport(`경민물류 ${MENU.find(([k]) => k === sec)![2]} ${stamp}.xlsx`, sheets);
  };
  const dayBar = (
    <div className="row" style={{ alignItems: 'center', gap: 6 }}>
      <button onClick={() => setDate(addDays(date, -1))}>◀ 전일</button>
      <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 'auto' }} />
      <button onClick={() => setDate(addDays(date, 1))}>익일 ▶</button>
      <button className="chip" onClick={() => setDate(today)}>오늘</button>
    </div>
  );
  const rangeBar = (
    <div className="row" style={{ alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} style={{ width: 'auto' }} />~
      <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} style={{ width: 'auto' }} />
      <button className="chip" onClick={() => { setFrom(`${today.slice(0, 7)}-01`); setTo(dayjs(today).endOf('month').format('YYYY-MM-DD')); }}>이번 달</button>
      <button className="chip" onClick={() => { const m = dayjs(today).subtract(1, 'month'); setFrom(m.format('YYYY-MM-01')); setTo(m.endOf('month').format('YYYY-MM-DD')); }}>지난 달</button>
      <button className="chip" onClick={() => { setFrom(`${today.slice(0, 4)}-01-01`); setTo(today); }}>올해</button>
    </div>
  );
  const monthBar = (
    <div className="row" style={{ alignItems: 'center', gap: 6 }}>
      <button onClick={() => setMonth(dayjs(`${month}-01`).subtract(1, 'month').format('YYYY-MM'))}>◀ 전월</button>
      <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ width: 'auto' }} />
      <button onClick={() => setMonth(dayjs(`${month}-01`).add(1, 'month').format('YYYY-MM'))}>익월 ▶</button>
    </div>
  );
  const total = data?.sheet.totals?.total;

  return (
    <div className="admin">
      <aside className="admin-nav">
        <div className="admin-nav-title">관리</div>
        {menu.map(([k, ic, l]) => (
          <button key={k} className={sec === k ? 'on' : ''} onClick={() => nav(`/admin/${k}`, { replace: true })}><span>{ic}</span>{l}</button>
        ))}
        <p className="muted small" style={{ padding: '8px 10px' }}>PC 전용 화면입니다. 휴대폰 화면은 그대로입니다.{admin ? ' 금액 화면은 관리자만 보입니다.' : ''}</p>
      </aside>
      <main className="admin-main">
        <div className="admin-head">
          <h2>{MENU.find(([k]) => k === sec)![2]}</h2>
          {sec === 'dispatch' || sec === 'daily' ? dayBar : sec === 'monthly' ? monthBar : sec === 'attendance' ? null : rangeBar}
          <span className="grow" />
          {data && <button className="primary" onClick={excel}>⬇ 엑셀</button>}
          {sec === 'dispatch' && <button onClick={() => exportSchedule(snap, date, date)}>⬇ 일정표 양식</button>}
        </div>

        {sec === 'dispatch' && data && 'summary' in data && (
          <div className="admin-cards">
            {Object.entries(data.summary).map(([k, v]) => (
              <div key={k} className={`admin-card ${(k === '미배치' || k === '배차대기') && v ? 'warn' : ''}`}><span>{k}</span><b>{v}</b></div>
            ))}
          </div>
        )}
        {MONEY_SECTIONS.includes(sec) && typeof total === 'number' && (
          <div className="admin-cards">
            <div className="admin-card"><span>{sec === 'ships' ? '선박비 합계' : '매출 합계 (부가세 포함)'}</span><b>{total.toLocaleString('ko-KR')}원</b></div>
            {typeof data?.sheet.totals?.count === 'number' && <div className="admin-card"><span>건수</span><b>{data.sheet.totals.count}</b></div>}
            {typeof data?.sheet.totals?.missing === 'number' && data.sheet.totals.missing > 0 && <div className="admin-card warn"><span>{sec === 'ships' ? '요금 미등록' : '금액 미입력'}</span><b>{data.sheet.totals.missing}</b></div>}
            {typeof data?.sheet.totals?.unbilled === 'number' && <div className="admin-card"><span>미청구</span><b>{data.sheet.totals.unbilled.toLocaleString('ko-KR')}원</b></div>}
            {typeof data?.sheet.totals?.unpaid === 'number' && <div className="admin-card"><span>미입금</span><b>{data.sheet.totals.unpaid.toLocaleString('ko-KR')}원</b></div>}
          </div>
        )}

        {sec === 'billing' && <BillingPanel from={from} to={to} />}
        {sec === 'attendance' ? <AttendancePanel /> : data && (
          <>
            <Table sheet={data.sheet} />
            {'extra' in data && data.extra && (<><h3 style={{ marginTop: 16 }}>{data.extra.name}</h3><Table sheet={data.extra} /></>)}
          </>
        )}
      </main>
    </div>
  );
}
