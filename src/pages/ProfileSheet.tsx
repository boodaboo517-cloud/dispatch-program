// 회원 정보 수정: 이름 · 연락처 · 비상 연락처 · 추가 정보. 본인(내 정보) 또는 관리자(사용자 권한에서)
import { useEffect, useState } from 'react';
import { store } from '../data/store.ts';
import { supabase } from '../data/supabase.ts';
import { Sheet } from '../ui/Sheet.tsx';

interface Info { name: string; phone: string; emergency_phone: string; memo: string }
const NEED_SQL = '회원 정보 칸이 아직 서버에 없습니다. Supabase에 회원 정보 SQL(update_20261025b.sql)을 한 번 실행해 주세요.';

/** self: 내 정보 (본인만 고칠 수 있는 칸만) · 아니면 관리자가 그 사람 정보를 고친다 */
export function ProfileSheet({ userId, email, self, close, onSaved }: { userId: string; email?: string; self: boolean; close: () => void; onSaved?: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [myEmail, setMyEmail] = useState(email ?? '');
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void (async () => {
      let { data, error } = await supabase!.from('profiles').select('name,phone,emergency_phone,memo').eq('id', userId).single();
      if (error) {
        setMissing(true);
        ({ data } = await supabase!.from('profiles').select('name').eq('id', userId).single() as never);
      }
      const d = (data ?? {}) as Partial<Info>;
      setInfo({ name: d.name ?? '', phone: d.phone ?? '', emergency_phone: d.emergency_phone ?? '', memo: d.memo ?? '' });
      if (self && !email) {
        const { data: u } = await supabase!.auth.getUser();
        setMyEmail(u.user?.email ?? '');
      }
    })();
  }, [userId]);
  const set = (p: Partial<Info>) => setInfo((i) => (i ? { ...i, ...p } : i));
  const save = async () => {
    if (!info) return;
    if (!info.name.trim()) return store.toast('이름을 넣어 주세요', 'error');
    setBusy(true);
    const { error } = self
      ? await supabase!.rpc('update_my_profile', { p_name: info.name, p_phone: info.phone, p_emergency_phone: info.emergency_phone, p_memo: info.memo })
      : await supabase!.from('profiles').update({ name: info.name.trim(), phone: info.phone.trim(), emergency_phone: info.emergency_phone.trim(), memo: info.memo }).eq('id', userId);
    setBusy(false);
    if (error) return store.toast(missing ? NEED_SQL : error.message, 'error');
    if (self) store.setSessionName(info.name.trim());
    store.toast('정보를 저장했습니다');
    onSaved?.();
    close();
  };
  return (
    <Sheet title={self ? '내 정보 수정' : `${info?.name ?? ''} 정보 수정`} onClose={close} footer={<button className="primary" disabled={busy || !info} onClick={() => void save()}>저장</button>}>
      {missing && <div className="banner yellow small">{NEED_SQL}</div>}
      {myEmail && <div className="field"><span>로그인 이메일</span><div className="muted">{myEmail} <span className="small">(바꿀 수 없음)</span></div></div>}
      {info && (
        <>
          <label className="field"><span>이름</span><input value={info.name} onChange={(e) => set({ name: e.target.value })} placeholder="예: 홍길동(9915)" /></label>
          <label className="field"><span>연락처</span><input type="tel" value={info.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="010-0000-0000" disabled={missing} /></label>
          <label className="field"><span>비상 연락처</span><input type="tel" value={info.emergency_phone} onChange={(e) => set({ emergency_phone: e.target.value })} placeholder="가족 등 (예: 배우자 010-…)" disabled={missing} /></label>
          <label className="field"><span>추가 정보</span><textarea rows={4} value={info.memo} onChange={(e) => set({ memo: e.target.value })} placeholder="예: 대형면허, 화물운송자격증, 차량 선호, 주소 등" disabled={missing} /></label>
          {self && <p className="muted small">연락처를 바꾸면 기사 명단의 연락처도 같이 바뀝니다. 권한·기사 연결은 관리자가 정합니다.</p>}
        </>
      )}
      {!info && <p className="muted">불러오는 중…</p>}
    </Sheet>
  );
}
