// 종이 일정표 모양 (확인용, 누르기 없음): 차량 한 대 = 한 줄. 선박 | 차량 | 기사 | 하차 | 차량 | 기사 | 상차 | 선박 (제주는 오전·오후)
import {
  DAY_STATUS_LABEL, FIELD_PART_LABEL, ON_CALL_SHIFT, pmArrival, shownMemo, driverZone, isDriverWorking, isExternal, isWaitShip, missingDriver, workText, offByZone, parseShip, seqMark, sitesGrouped,
  type BoardRow, type DailyOrder, type FieldAssignment, type Snapshot, type Zone,
} from '../../domain/index.ts';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { StorageTag, regionOf, unloadInfo } from './parts.tsx';
import { useSnap } from '../../ui/hooks.ts';
import { clientName, driverName, productName, qtyText, shipTimeOf, vehicleNo } from '../../ui/labels.ts';

const ZONE_NAME: Record<Zone, string> = { land: '육지', jeju: '제주' };
const HEAD: Record<Zone, string[]> = {
  land: ['선박', '차량', '기사', '하차', '차량', '기사', '상차', '선박'],
  jeju: ['선박', '차량', '이름', '오전', '차량', '이름', '오후', '선박'],
};

function Cols() {
  return (
    <colgroup>
      <col className="c-ship" /><col className="c-veh" /><col className="c-drv" /><col className="c-body" />
      <col className="c-veh" /><col className="c-drv" /><col className="c-body" /><col className="c-ship" />
    </colgroup>
  );
}

/** 25자 넘는 긴 내용은 줄을 바꿔 글씨가 너무 작아지지 않게 한다 */
const WRAP_AT = 25;

/** 칸 안에서 줄을 바꾸지 않고, 길면 글자를 줄여 한 줄에 맞춘다 (최소 6px, 그래도 길면 옆으로 눌러서). 25자 넘으면 줄바꿈 */
function Fit({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const cell = el?.parentElement;
    if (!el || !cell) return;
    const fit = () => {
      el.style.fontSize = '';
      el.style.transform = '';
      el.classList.toggle('wrap', (el.textContent ?? '').trim().length > WRAP_AT);
      const cs = getComputedStyle(cell);
      const avail = cell.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const need = el.scrollWidth;
      if (avail > 0 && need > avail) {
        const base = parseFloat(getComputedStyle(el).fontSize);
        el.style.fontSize = `${Math.max(6, Math.floor((base * avail / need) * 10) / 10)}px`;
        // 최소 크기에서도 넘치면 옆으로 살짝 눌러서 맞춘다
        const still = el.scrollWidth;
        if (still > avail) el.style.transform = `scaleX(${(avail / still).toFixed(3)})`;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(cell);
    return () => ro.disconnect();
  });
  return <span ref={ref} className="fit">{children}</span>;
}

/** 선박 칸: (예약업체·표시 작게 한 줄) / 선박명 / 시간(작게). 지역(기항지)은 표시하지 않음 */
function ShipText({ snap, ship, tag, nextDay }: { snap: Snapshot; ship: string | null; tag: string; nextDay?: boolean }) {
  if (!ship) return null;
  const time = shipTimeOf(snap, ship);
  return (
    <div className="ps-ship">
      {tag && <div className="ps-line"><Fit><span className="ps-tag">{tag}</span></Fit></div>}
      <div className="ps-line"><Fit><span className="ps-name">{parseShip(ship).name}</span></Fit></div>
      {(time || nextDay) && <div className="ps-time">{nextDay && <span className="ps-nextday">익일</span>}{time}</div>}
    </div>
  );
}

/** 오더 칸: 거래처별로 묶어 "업체 품목 수량, 품목 수량". 바로 위에 상차지(하차는 하차지)·비고·품목 주의사항을 빨간 작은 글씨로 */
function Orders({ snap, list, label }: { snap: Snapshot; list: DailyOrder[]; label?: ReactNode }) {
  const groups: DailyOrder[][] = [];
  for (const o of list) {
    const last = groups[groups.length - 1];
    if (last && clientName(snap, last[0]) === clientName(snap, o)) last.push(o);
    else groups.push([o]);
  }
  return (
    <>
      {groups.map((g) => {
        const notes = [...new Set(g.flatMap((o) => {
          const product = snap.products.find((x) => x.id === o.product_id);
          return [
            workText(o),
            o.kind === 'load' ? o.pickup_place : o.dropoff_place,
            o.kind === 'load' && o.shipment === 'bulk' ? '벌크' : '',
            o.delayed_from ? '⏸연기' : '',
            shownMemo(snap, o),
            product?.caution?.split('\n')[0],
          ].map((x) => x?.trim() ?? '');
        }).filter(Boolean))];
        // 품목마다 기본 지역을 품목 글자 바로 위에 아주 작게 (줄 높이는 그대로)
        const items = g.map((o) => ({ id: o.id, o, name: productName(snap, o), qty: qtyText(o), text: [productName(snap, o), qtyText(o)].filter(Boolean).join(' '), region: regionOf(snap, o) })).filter((x) => x.text);
        return (
          <div key={g[0].id} className="ps-ord">
            {notes.length > 0 && <div className="ps-oline"><Fit><span className="ps-note">{notes.join(' · ')}</span></Fit></div>}
            <div className="ps-oline"><Fit>
              {label}{label ? ' ' : ''}{clientName(snap, g[0])}{items.length ? ' ' : ''}
              {items.map((x, i) => (
                <span key={x.id} className="ps-prod">{x.region && <span className="ps-region">{x.region}</span>}<span>{x.name}<StorageTag snap={snap} o={x.o} />{x.name && x.qty ? ' ' : ''}{x.qty}{i < items.length - 1 ? ', ' : ''}</span></span>
              ))}
              {!clientName(snap, g[0]) && !items.length && '·'}
            </Fit></div>
          </div>
        );
      })}
    </>
  );
}

function VehicleRow({ snap, row }: { snap: Snapshot; row: BoardRow }) {
  const status = row.status && row.status !== 'field' ? row.status : '';
  const helper = row.helperId ? <div className="ps-oline center"><Fit><span className="ps-helper">+{driverName(snap, row.helperId)} {row.helperRole}</span></Fit></div> : null;
  const start = row.startTime || row.startPlace
    ? <div className="ps-oline center"><Fit><span className={`ps-start ${row.startDefault ? 'dflt' : ''}`}>{[row.startTime, row.startPlace].filter(Boolean).join(' ')}</span></Fit></div>
    : null;
  const noUnload = missingDriver(row, 'unload');
  const info = unloadInfo(snap, row);
  // 야간 기사는 상차(오후) 기사 칸에도 빨간 "야간"과 함께 (상차 기사가 미배치면 미배치 대신 야간 기사만)
  const nightDrv = row.nightDriverId ? <div className="ps-oline center"><Fit><span className="ps-nightdrv"><span className="ps-nightlbl">야간</span> {driverName(snap, row.nightDriverId)}</span></Fit></div> : null;
  // 오후도착: 하차는 오후 칸에서 오후 기사가 / 당일 왕복으로 건너간 쪽 줄: 야간 작업을 하차·상차 칸 안에 바로
  const pm = !row.secondary && pmArrival(row);
  const inline = row.secondary;
  const nightOf = (k: 'load' | 'unload') => (inline ? row.nights.filter((o) => o.kind === k) : []);
  const NIGHT = <span className="ps-nightlbl">야간</span>;
  const shownUnloads = pm ? [] : row.unloads;
  const noLoad = (inline ? (row.loads.length > 0 || nightOf('load').length > 0) && !row.loadDriverId : missingDriver(row, 'load')) && !nightDrv;
  const MISSING = <div className="ps-oline center"><Fit><span className="ps-nodrv">미배치</span></Fit></div>;
  const name = <>{start}{noUnload ? MISSING : !row.driverId && row.amLabel
    ? <div className="ps-oline center"><Fit><span className="ps-pmarr">{row.amLabel}</span></Fit></div>
    : row.driverId && row.driverId === row.nightDriverId ? nightDrv
    : <div className="ps-oline center"><Fit>{driverName(snap, row.driverId)}{seqMark(row.unloadSeq)}</Fit></div>}{helper}</>;
  const loadDrvName = row.loadDriverId === row.nightDriverId ? '' : driverName(snap, row.loadDriverId);
  const loadName = <>{noLoad ? MISSING : loadDrvName || !nightDrv ? <div className="ps-oline center"><Fit>{loadDrvName}{seqMark(row.loadSeq)}</Fit></div> : null}{nightDrv}{helper}</>;
  // 야간 상차 뒤 아침 배: 출발 선박에 "익일"
  const nextDay = !!row.departureShip && row.nights.some((o) => o.kind === 'load' && o.departure_ship === row.departureShip)
    && !row.loads.some((o) => o.departure_ship === row.departureShip);
  const statusText = status || row.statusMemo
    ? <>{status && <span className={`st ${status}`}>{DAY_STATUS_LABEL[status]}</span>}{row.statusMemo && <span className="ps-red"> {row.statusMemo}</span>}</>
    : null;
  // 분홍 표시: 오전 칸은 도착 선박, 오후 칸은 마감(출발) 선박이 연결됐을 때만
  // 수리: 하루 이상은 양쪽, 반나절은 그 반쪽 차량번호에 빨간 테두리 + "수리", 경미 수리는 ⚡
  const vehCell = (ship: string | null, half: 'am' | 'pm') => {
    const halfRepair = row.shortRepair === half;
    return (
      <td className="veh"><Fit><span className={`ps-pill veh ${ship && !isWaitShip(ship) ? '' : 'plain'} ${row.inRepair || halfRepair ? 'repair' : ''}`}>{row.vehicle.short_no}{row.shortRepair === 'quick' ? '⚡' : ''}</span></Fit>
        {halfRepair && <div className="ps-repair-half">수리</div>}</td>
    );
  };
  // 야간 작업: 차량 줄 바로 아래 한 줄 (기사 · 상차/하차 내용 · 선박)
  const nightLine = !inline && (row.nights.length > 0 || row.nightDriverId) ? (
    <tr className="night">
      <td className="ship" />
      <td className="veh"><Fit><span className="ps-nightlbl">야간</span></Fit></td>
      <td className={`drv${row.nights.length && !row.nightDriverId ? ' nodrv' : ''}`}>{row.nightDriverId ? <div className="ps-oline center"><Fit>{driverName(snap, row.nightDriverId)}</Fit></div> : row.nights.length ? MISSING : null}</td>
      <td className="body" colSpan={5}>
        {row.nights.map((o) => (
          <div key={o.id} className="ps-oline"><Fit>
            <span className="ps-night">{o.kind === 'load' ? '상차' : '하차'}{o.zone !== row.zone ? `(${o.zone === 'land' ? '육지' : '제주'})` : ''}</span>{' '}
            {clientName(snap, o)} {productName(snap, o)}<StorageTag snap={snap} o={o} /> {qtyText(o)}{o.departure_ship ? ` → ${parseShip(o.departure_ship).name}` : ''}
          </Fit></div>
        ))}
      </td>
    </tr>
  ) : null;
  return (
    <>
    <tr className={row.secondary ? 'secondary' : ''}>
      <td className="ship"><ShipText snap={snap} ship={row.arrivalShip} tag={row.arrivalTag} /></td>
      {vehCell(row.arrivalShip, 'am')}
      <td className={`drv${noUnload ? ' nodrv' : ''}`}>{name}</td>
      <td className="body">
        {shownUnloads.length ? <Orders snap={snap} list={shownUnloads} /> : !row.unloadNote && !info.length && !nightOf('unload').length && !pm ? <Fit>{statusText}</Fit> : null}
        {nightOf('unload').length > 0 && <Orders snap={snap} list={nightOf('unload')} label={NIGHT} />}
        {info.map((t) => <div key={t} className="ps-oline"><Fit><span className="ps-rownote">{t}</span></Fit></div>)}
        {row.unloadNote && <div className="ps-oline"><Fit><span className="ps-rownote">{row.unloadNote}</span></Fit></div>}
      </td>
      {vehCell(row.departureShip, 'pm')}
      <td className={`drv${noLoad ? ' nodrv' : ''}`}>{loadName}</td>
      <td className="body">
        {row.carried.map((o) => (
          <div key={o.id} className="ps-oline"><Fit><span className="ps-carried">[[ {[clientName(snap, o), productName(snap, o), qtyText(o)].filter(Boolean).join(' ')} ]]</span></Fit></div>
        ))}
        {pm && row.unloads.length > 0 && <Orders snap={snap} list={row.unloads} label={<span className="ps-kind">하차</span>} />}
        {row.loads.length ? <Orders snap={snap} list={row.loads} /> : shownUnloads.length && !row.carried.length && !row.loadNote && !nightOf('load').length ? <Fit>{statusText}</Fit> : null}
        {nightOf('load').length > 0 && <Orders snap={snap} list={nightOf('load')} label={NIGHT} />}
        {pm && !row.loads.length && !row.carried.length && !row.loadNote ? <Fit>{statusText}</Fit> : null}
        {row.loadNote && <div className="ps-oline"><Fit><span className="ps-rownote">{row.loadNote}</span></Fit></div>}
      </td>
      <td className="ship"><ShipText snap={snap} ship={row.departureShip} tag={row.departureTag} nextDay={nextDay} /></td>
    </tr>
    {nightLine}
    </>
  );
}

/** 배차 대기(노란 칸) · 용차·화주배차(빨간 글씨) 줄 */
function WaitingRow({ snap, o }: { snap: Snapshot; o: DailyOrder }) {
  const ext = isExternal(o);
  const load = o.kind === 'load';
  const veh = ext
    ? <td className="veh"><div className="ps-oline center"><Fit><span className="ps-ext">{o.carrier_name || (o.carrier_type === 'shipper' ? '화주' : '용차')}</span></Fit></div></td>
    : <td className="veh wait"><Fit>미배차</Fit></td>;
  return (
    <tr className={ext ? 'external' : 'waiting'}>
      <td className="ship">{!load && <ShipText snap={snap} ship={o.arrival_ship} tag={o.arrival_ship_tag} />}</td>
      {load ? <td className="veh" /> : veh}
      <td className="drv" />
      <td className="body">{!load && <Orders snap={snap} list={[o]} />}</td>
      {load ? veh : <td className="veh" />}
      <td className="drv" />
      <td className="body">{load && <Orders snap={snap} list={[o]} />}</td>
      <td className="ship">{load && <ShipText snap={snap} ship={o.departure_ship} tag={o.departure_ship_tag} />}</td>
    </tr>
  );
}

export function SheetBoard(p: { zone: Zone; date: string; rows: BoardRow[]; waiting: DailyOrder[]; external: DailyOrder[]; field: FieldAssignment[] }) {
  const snap = useSnap();

  // 비지정 근무자(자유롭게 일함)는 근무·대기·휴무 명단에서 뺀다 (배차된 차량 줄에는 그대로 나옴)
  const off = offByZone(snap, p.date)[p.zone].filter((d) => !d.unlisted);
  // 근무자: 이 표 차량에 배차된 기사(오전·오후·동승) + 이 지역 근무일인데 아직 차량 없는 기사(대기)
  const offIds = new Set(off.map((d) => d.id));
  // 당일 왕복으로 건너간 쪽 줄에서 야간 기사가 맡은 일은 야간으로만 센다
  const dayIdsOf = (r: BoardRow) => [r.driverId, r.loadDriverId, r.helperId].filter((x) => !r.secondary || x !== r.nightDriverId);
  const assignedIds = new Set(p.rows.flatMap(dayIdsOf).filter((x): x is string => !!x));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ko');
  const working = snap.drivers.filter((d) => assignedIds.has(d.id) && !d.unlisted).sort(byName);
  // 야간 기사도 근무 명단에 빨간 "야간"과 함께 (낮에도 일하면 낮 명단과 야간에 모두)
  const nightIds = new Set(p.rows.map((r) => r.nightDriverId).filter((x): x is string => !!x));
  const nightDrivers = snap.drivers.filter((d) => nightIds.has(d.id)).sort(byName);
  const workNames: ReactNode[] = [...working.map((d) => d.name), ...nightDrivers.map((d) => <span key={d.id}><span className="ps-nightlbl">야간</span> {d.name}</span>)];
  const busyElsewhere = new Set(snap.vehicle_days.filter((v) => v.date === p.date).flatMap((v) => [v.driver_id, v.load_driver_id, v.helper_driver_id, v.night_driver_id]));
  const standby = snap.drivers
    .filter((d) => d.staff_type === '기사' && d.shift !== ON_CALL_SHIFT && !d.unlisted && driverZone(d) === p.zone && !offIds.has(d.id) && !assignedIds.has(d.id) && !nightIds.has(d.id) && !busyElsewhere.has(d.id) && isDriverWorking(snap, d, p.date))
    .sort(byName);
  return (
    <table className={`paper ${p.zone}`}>
      <Cols />
      <thead>
        <tr><th colSpan={8} className="zone">{ZONE_NAME[p.zone]}</th></tr>
        <tr>{HEAD[p.zone].map((h, i) => <th key={i}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {p.rows.map((r) => <VehicleRow key={r.vehicle.id + (r.secondary ? '-2' : '')} snap={snap} row={r} />)}
        {p.waiting.map((o) => <WaitingRow key={o.id} snap={snap} o={o} />)}
        {p.external.map((o) => <WaitingRow key={o.id} snap={snap} o={o} />)}

        {(workNames.length > 0 || standby.length > 0) && (
          <tr className="fieldrow workrow first">
            <td className="site"><Fit>기사 근무</Fit></td>
            <td className="body" colSpan={7}><Fit>{workNames.map((n, i) => <span key={i}>{i ? ', ' : ''}{n}</span>)}{standby.length ? <span className="ps-standby">{workNames.length ? '  ·  ' : ''}대기: {standby.map((d) => d.name).join(', ')}</span> : null}</Fit></td>
          </tr>
        )}
        {off.some((d) => d.staff_type === '기사') && (
          <tr className={`fieldrow offrow${workNames.length || standby.length ? '' : ' first'}`}>
            <td className="site"><Fit>기사 휴무</Fit></td>
            <td className="body" colSpan={7}><Fit>{off.filter((d) => d.staff_type === '기사').map((d) => d.name).join(', ')}</Fit></td>
          </tr>
        )}

      </tbody>
    </table>
  );
}

/** 현장 표 (육지·제주와 따로, 근무자가 없어도 표시): 근무지 | 차량 | 이름 | 업무, 맨 밑에 현장 휴무 */
export function SheetExtras({ date, field }: { date: string; field: FieldAssignment[] }) {
  const snap = useSnap();
  const rows = sitesGrouped(snap, field).groups.flatMap((g) => g.rows);
  const offAll = offByZone(snap, date);
  const fieldOff = [...offAll.jeju, ...offAll.land].filter((d) => d.staff_type !== '기사' && !d.unlisted).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const siteName = (f: FieldAssignment) => snap.field_sites.find((x) => x.id === f.site_id)?.name ?? '근무지 미정';
  return (
    <table className="paper fieldwork">
      <colgroup><col style={{ width: '20%' }} /><col style={{ width: '13%' }} /><col style={{ width: '15%' }} /><col /></colgroup>
      <thead>
        <tr><th colSpan={4} className="zone">현장</th></tr>
        <tr><th>근무지</th><th>차량</th><th>이름</th><th>업무</th></tr>
      </thead>
      <tbody>
        {rows.map((f, i) => (
          <tr key={f.id} className={i > 0 && siteName(rows[i - 1]) !== siteName(f) ? 'newsite' : ''}>
            <td className="site"><Fit>{i === 0 || siteName(rows[i - 1]) !== siteName(f) ? siteName(f) : ''}</Fit></td>
            <td className="veh">{f.vehicle_id && <Fit><span className="ps-pill veh plain">{vehicleNo(snap, f.vehicle_id)}</span></Fit>}</td>
            <td className="drv"><Fit>{driverName(snap, f.staff_id)}{f.part ? <span className="ps-part">{FIELD_PART_LABEL[f.part]}</span> : null}</Fit></td>
            <td className="body"><Fit>{f.task}</Fit></td>
          </tr>
        ))}
        {!rows.length && <tr><td colSpan={4} className="body" style={{ color: '#888', textAlign: 'center' }}>근무자 없음</td></tr>}
        <tr className="fieldrow offrow first">
          <td className="site"><Fit>현장 휴무</Fit></td>
          <td className="body" colSpan={3}><Fit>{fieldOff.map((d) => d.name).join(', ') || '없음'}</Fit></td>
        </tr>
      </tbody>
    </table>
  );
}
