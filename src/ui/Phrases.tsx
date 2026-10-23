// 자주 쓰는 문구: 누르면 넣고, "＋ 추가"로 그 자리에서 문구를 늘리고, "편집"에서 ✕로 지운다 (설정에 저장, 모두 같이 씀)
import { useState } from 'react';
import { newId } from '../domain/index.ts';
import { store } from '../data/store.ts';
import { useRole, useSnap } from './hooks.ts';
import { setting } from './labels.ts';

export function saveSetting(key: string, value: unknown) {
  store.run((tx) => {
    const cur = tx.list('settings').find((s) => s.key === key);
    if (cur) tx.update('settings', cur.id, { value });
    else tx.insert('settings', { id: newId(), key, value });
  });
}

export function PhraseChips({ settingKey, defaults = [], onPick, label = '자주 쓰는 문구', fixed }: {
  settingKey: string; defaults?: string[]; onPick: (phrase: string) => void; label?: string; fixed?: React.ReactNode;
}) {
  const snap = useSnap();
  const { staff } = useRole();
  const [edit, setEdit] = useState(false);
  const list = setting<string[]>(snap, settingKey, defaults);
  const add = () => {
    const t = prompt('추가할 문구')?.trim();
    if (t && !list.includes(t)) saveSetting(settingKey, [...list, t]);
  };
  return (
    <div className="phrases">
      <div className="row" style={{ alignItems: 'center' }}>
        <span className="muted small grow">{label}</span>
        {staff && list.length > 0 && <button className="ghost small" style={{ minHeight: 32 }} onClick={() => setEdit(!edit)}>{edit ? '완료' : '편집'}</button>}
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        {fixed}
        {list.map((ph) => (
          <button key={ph} type="button" className={`chip${edit ? ' editing' : ''}`}
            onClick={() => (edit ? confirm(`"${ph}" 문구를 지울까요?`) && saveSetting(settingKey, list.filter((x) => x !== ph)) : onPick(ph))}>
            {ph}{edit && <b style={{ color: 'var(--red)', marginLeft: 6 }}>✕</b>}
          </button>
        ))}
        {staff && !edit && <button type="button" className="chip" style={{ borderStyle: 'dashed', color: 'var(--blue)' }} onClick={add}>＋ 추가</button>}
      </div>
    </div>
  );
}
