import { setIdGenerator } from '../ids.ts';
import type { Snapshot, Vehicle, Ship, Client, Product } from '../types.ts';
import { emptySnapshot } from '../types.ts';

export function resetIds() {
  let n = 0;
  setIdGenerator(() => `id${++n}`);
}

export function vehicle(id: string, short: string, p: Partial<Vehicle> = {}): Vehicle {
  return {
    id, plate: `제주90바${short}`, short_no: short, vehicle_type: '5톤', usage: '배차', ownership: '자차',
    default_driver_id: null, status: '운행', home_zone: 'land', sort_order: 0, oil_interval_km: null, ...p,
  };
}

export function ship(name: string, departs: string, p: Partial<Ship> = {}): Ship {
  return { id: `ship-${name}-${departs}`, name, departs_at: departs, route: 'both', arrival_day_offset: 1, sort_order: 0, ...p };
}

export function client(id: string, name: string): Client {
  return { id, name, manager: '', phone: '', default_ship: null, memo: '' };
}

export function product(id: string, client_id: string, name: string, p: Partial<Product> = {}): Product {
  return {
    id, client_id, name, default_region: '제주시', default_quantity: 10, default_unit: '파렛트',
    pickup_address: '', pickup_lat: null, pickup_lng: null, pickup_note: '',
    dropoff_address: '', dropoff_lat: null, dropoff_lng: null, dropoff_note: '',
    pickup_contact_name: '', pickup_contact_phone: '', dropoff_contact_name: '', dropoff_contact_phone: '',
    storage: 'ambient', temp_min: null, temp_max: null, caution: '', ...p,
  };
}

export function baseSnapshot(): Snapshot {
  const s = emptySnapshot();
  s.vehicles = [vehicle('v9915', '9915'), vehicle('v9914', '9914', { home_zone: 'jeju' }), vehicle('v8948', '8948', { home_zone: 'jeju' })];
  s.ships = [ship('제이엘', '16:10'), ship('완도', '08:40'), ship('목포', '18:00', { arrival_day_offset: 2 })];
  s.clients = [client('c-sin', '신제주운송'), client('c-dm', '도민물류'), client('c-jr', '제주로지')];
  s.products = [
    product('p-sin', 'c-sin', '잡화', { default_quantity: 2 }),
    product('p-gam', 'c-dm', '감귤', { default_quantity: 10 }),
    product('p-sanji', 'c-jr', '산지 감귤', { default_quantity: 12 }),
  ];
  s.product_pricing = [{ id: 'pp1', product_id: 'p-gam', calc_method: 'per_pallet', unit_price: 90000 }];
  return s;
}
