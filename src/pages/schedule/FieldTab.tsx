// 현장근무 탭: 근무지별 · 이름 · 업무 · 지급 차량 / 휴무자
import { blankField, saveFieldAssignment, setDayOff, sitesGrouped, type FieldAssignment } from '../../domain/index.ts';
import { store } from '../../data/store.ts';
import { useRole, useSnap } from '../../ui/hooks.ts';
import { Cell } from '../../ui/Cell.tsx';
import { driverName, vehicleNo } from '../../ui/labels.ts';
import { usePickers } from '../../ui/pickers.tsx';
import { useSheet, Sheet } from '../../ui/Sheet.tsx';

export function FieldTab({ date }: { date: string }) {
  const snap = useSnap();
  const { staff } = useRole();
  const pick = usePickers();
  const sheet = useSheet();
  const rows = snap.field_assignments.filter((f) => f.date === date);
  const { groups, off } = sitesGrouped(snap, rows);
  const save = (f: FieldAssignment) => store.run((tx) => saveFieldAssignment(tx, f));

  const show = (title: string, text: string, edit?: () => void) =>
    sheet.open((close) => (
      <Sheet title={title} onClose={close} footer={staff && edit ? <button className="primary" onClick={() => { close(); edit(); }}>수정</button> : undefined}>
        <p style={{ fontSize: 19 }}>{text || '-'}</p>
      </Sheet>
    ));

  const editStaff = async (f: FieldAssignment) => {
    const id = await pick.staff(date);
    if (id) save({ ...f, staff_id: id });
  };
  const editTask = async (f: FieldAssignment) => {
    const t = await pick.memo(f.task, '업무');
    if (t !== null) save({ ...f, task: t });
  };
  const editVehicle = async (f: FieldAssignment) => {
    const v = await pick.anyVehicle();
    if (v !== undefined) save({ ...f, vehicle_id: v });
  };
  const add = async (siteId: string | null) => {
    const site = siteId ?? (await pick.site());
    if (!site) return;
    const id = await pick.staff(date);
    if (!id) return;
    store.run((tx) => saveFieldAssignment(tx, blankField({ date, site_id: site, staff_id: id, sort_order: rows.length })));
  };
  const addOff = async () => {
    const id = await pick.staff(date);
    if (id) store.run((tx) => setDayOff(tx, date, id, true));
  };

  const line = (f: FieldAssignment) => {
    const name = driverName(snap, f.staff_id);
    const veh = f.vehicle_id ? `${snap.vehicles.find((v) => v.id === f.vehicle_id)?.vehicle_type ?? ''} ${vehicleNo(snap, f.vehicle_id)}` : '';
    return (
      <div key={f.id} className="row" style={{ borderBottom: '1px solid #eee', background: '#fff' }}>
        <div style={{ width: 90 }}>
          <Cell className={name ? '' : 'empty'} onTap={() => (name ? show('이름', name, () => editStaff(f)) : editStaff(f))} onLong={staff ? () => editStaff(f) : undefined}>{name || '＋'}</Cell>
        </div>
        <div className="grow">
          <Cell className={f.task ? '' : 'empty'} onTap={() => (f.task ? show('업무', f.task, () => editTask(f)) : staff && editTask(f))} onLong={staff ? () => editTask(f) : undefined}>
            {f.task || '＋'}
            {f.source === 'recurring' && !f.edited_manually && <span className="muted small"> 고정</span>}
            {f.source === 'maintenance' && <span className="badge red">정비</span>}
          </Cell>
        </div>
        <div style={{ width: 96 }}>
          <Cell className={veh ? '' : 'empty'} onTap={() => (veh ? show('지급 차량', veh, () => editVehicle(f)) : staff && editVehicle(f))} onLong={staff ? () => editVehicle(f) : undefined}>{veh || (staff ? '＋' : '')}</Cell>
        </div>
        {staff && <button className="ghost" aria-label="삭제" onClick={() => confirm('이 줄을 삭제할까요?') && store.run((tx) => tx.remove('field_assignments', f.id))}>✕</button>}
      </div>
    );
  };

  return (
    <div>
      {groups.map((g) => (
        <div key={g.site.id} className="card" style={{ padding: 0, overflow: 'hidden', border: '2px solid var(--red)' }}>
          <div className="row" style={{ padding: '6px 12px', background: '#fef2f2' }}>
            <b className="grow">{g.site.name}</b>
            {staff && g.site.id && <button className="ghost" onClick={() => add(g.site.id)}>＋ 추가</button>}
          </div>
          {g.rows.map(line)}
        </div>
      ))}
      {!groups.length && <p className="muted">현장근무 없음</p>}
      {staff && <button style={{ width: '100%' }} onClick={() => add(null)}>＋ 현장근무 추가</button>}
      <div className="card">
        <div className="row"><b className="grow">휴무자</b>{staff && <button className="ghost" onClick={addOff}>＋ 휴무 지정</button>}</div>
        {off.length ? off.map((f) => (
          <div key={f.id} className="row" style={{ minHeight: 44 }}>
            <span className="grow">{driverName(snap, f.staff_id)}</span>
            {staff && <button className="ghost" onClick={() => store.run((tx) => setDayOff(tx, date, f.staff_id!, false))}>휴무 취소</button>}
          </div>
        )) : <p className="muted">없음</p>}
      </div>
    </div>
  );
}
