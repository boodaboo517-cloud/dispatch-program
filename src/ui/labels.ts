import { shipTimeOf as shipTimeOfShips } from '../domain/ships.ts';
import type { DailyOrder, ShipTag, Snapshot, Storage, Zone, Kind } from '../domain/index.ts';

export const ZONE_LABEL: Record<Zone, string> = { land: '육지', jeju: '제주' };
export const kindLabel = (zone: Zone, kind: Kind) =>
  zone === 'land' ? (kind === 'unload' ? '하차' : '상차') : kind === 'unload' ? '오전' : '오후';
export const arrivalShipLabel = (zone: Zone) => (zone === 'land' ? '상행선박' : '도착 선박');
export const departureShipLabel = (zone: Zone) => (zone === 'land' ? '하행선박' : '오후 선박');
export const STORAGE_LABEL: Record<Storage, string> = { ambient: '상온', chilled: '냉장', frozen: '냉동' };

export const clientName = (s: Snapshot, o: Pick<DailyOrder, 'client_id' | 'client_text'>) =>
  s.clients.find((c) => c.id === o.client_id)?.name ?? o.client_text ?? '';
export const productName = (s: Snapshot, o: Pick<DailyOrder, 'product_id' | 'product_text'>) =>
  s.products.find((p) => p.id === o.product_id)?.name ?? o.product_text ?? '';
export const productOf = (s: Snapshot, o: Pick<DailyOrder, 'product_id'>) => s.products.find((p) => p.id === o.product_id);
export const vehicleNo = (s: Snapshot, id: string | null) => s.vehicles.find((v) => v.id === id)?.short_no ?? '';
export const driverName = (s: Snapshot, id: string | null) => s.drivers.find((d) => d.id === id)?.name ?? '';
export const shipText = (ship: string | null, tag: ShipTag | '') => (ship ? `${tag ? tag + ' ' : ''}${ship}` : '');
export const shipTimeOf = (s: Snapshot, value: string | null) => shipTimeOfShips(s.ships, value);
export const qtyText = (o: Pick<DailyOrder, 'quantity' | 'unit'>) => (o.quantity == null ? '' : `${o.quantity}${o.unit === '파렛트' ? 'p' : o.unit}`);

export function orderText(s: Snapshot, o: DailyOrder) {
  return [clientName(s, o), productName(s, o), o.region, qtyText(o), o.memo].filter(Boolean).join(' · ');
}

export function setting<T>(s: Snapshot, key: string, fallback: T): T {
  const v = s.settings.find((x) => x.key === key)?.value;
  return (v === undefined || v === null ? fallback : v) as T;
}
