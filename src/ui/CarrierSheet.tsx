// 배차 대기 짐 → 용차배차 / 화주배차: 업체·기사 · 차량번호 · 연락처만 바로 적는 화면
import { useState } from 'react';
import { saveOrder, type CarrierType, type DailyOrder } from '../domain/index.ts';
import { store } from '../data/store.ts';
import { Seg } from './Picker.tsx';
import { Sheet } from './Sheet.tsx';

export function CarrierSheet({ order, type, close }: { order: DailyOrder; type: Exclude<CarrierType, 'own'>; close: () => void }) {
  const [ct, setCt] = useState<Exclude<CarrierType, 'own'>>(type);
  const [name, setName] = useState(order.carrier_name ?? '');
  const [veh, setVeh] = useState(order.carrier_vehicle ?? '');
  const [phone, setPhone] = useState(order.carrier_phone ?? '');
  const save = () => {
    const cur = store.getState().snap.daily_orders.find((o) => o.id === order.id) ?? order;
    store.run((tx) => saveOrder(tx, { ...cur, vehicle_id: null, driver_id: null, same_day: false, carrier_type: ct, carrier_name: name.trim(), carrier_vehicle: veh.trim(), carrier_phone: phone.trim() }));
    store.toast(`${ct === 'hired' ? '용차' : '화주배차'}로 배차했습니다`);
    close();
  };
  return (
    <Sheet title={ct === 'hired' ? '🚚 용차배차' : '🏭 화주배차'} onClose={close} footer={<>
      <button onClick={close}>취소</button>
      <button className="primary" onClick={save}>저장</button>
    </>}>
      <Seg value={ct} onChange={(v: Exclude<CarrierType, 'own'>) => setCt(v)} options={[{ value: 'hired', label: '용차' }, { value: 'shipper', label: '화주배차' }]} />
      <div className="row" style={{ marginTop: 10 }}>
        <input autoFocus placeholder={ct === 'hired' ? '용차 업체·기사' : '화주 쪽 업체·기사 (모르면 비움)'} value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="차량번호" style={{ width: 130 }} value={veh} onChange={(e) => setVeh(e.target.value)} />
      </div>
      <input type="tel" placeholder="연락처" style={{ marginTop: 8 }} value={phone} onChange={(e) => setPhone(e.target.value)} />
      <p className="muted small">{ct === 'hired' ? '외부 차량이라 배차 대기로 세지 않고 "용차·화주배차"에 따로 모입니다.' : '화주가 직접 차를 보내는 건입니다. 배차 대기로 세지 않습니다.'}</p>
    </Sheet>
  );
}
