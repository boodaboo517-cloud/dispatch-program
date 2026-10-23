// 개인별 근로계약 근무별 수당 입력 (관리자·배차만)
import { useState } from 'react';
import { WORK_TYPES, payRatesOf, setPayRate, type WorkType } from '../domain/index.ts';
import { store } from '../data/store.ts';
import { useSnap } from './hooks.ts';

const won = (n: number) => n.toLocaleString('ko-KR');

function RateInput({ driverId, type, value }: { driverId: string; type: WorkType; value: number | undefined }) {
  const [text, setText] = useState(value == null ? '' : won(value));
  const save = () => {
    const digits = text.replace(/[^\d]/g, '');
    const amount = digits ? Number(digits) : null;
    if (amount === (value ?? null)) return;
    store.run((tx) => setPayRate(tx, { driver_id: driverId, type, amount }));
    setText(amount == null ? '' : won(amount));
  };
  return (
    <label className="pay-rate">
      <span>{type === '시간외근무' ? '시간외(시간당)' : type}</span>
      <input inputMode="numeric" value={text} placeholder="-" onChange={(e) => setText(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <small>원</small>
    </label>
  );
}

/** 근무형태별 1회 수당. 근무현황 기간 합계에 곱해진다 */
export function PayRatesCard({ driverId }: { driverId: string }) {
  const snap = useSnap();
  const rates = payRatesOf(snap, driverId)?.rates ?? {};
  return (
    <div className="card">
      <b>근무별 수당 (근로계약)</b>
      <p className="muted small" style={{ margin: '4px 0 8px' }}>근무형태 1회당 금액 (시간외근무는 1시간당). 근무현황에서 횟수 × 수당으로 합계가 나옵니다. 시간외는 그날 금액을 직접 적으면 그 금액으로 계산합니다.</p>
      <div className="pay-rates">
        {WORK_TYPES.map((t) => <RateInput key={`${driverId}-${t}-${rates[t] ?? ''}`} driverId={driverId} type={t} value={rates[t]} />)}
      </div>
    </div>
  );
}
