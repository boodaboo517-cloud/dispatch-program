import { expect, it } from 'vitest';
import { parseQty } from '../../ui/QtyInput.tsx';

it('숫자 뒤 단위 입력', () => {
  expect(parseQty('10파렛트')).toEqual({ quantity: 10, unit: '파렛트' });
  expect(parseQty('12p')).toEqual({ quantity: 12, unit: '파렛트' });
  expect(parseQty('3 대')).toEqual({ quantity: 3, unit: '대' });
  expect(parseQty('7.5m')).toEqual({ quantity: 7.5, unit: 'm' });
  expect(parseQty('5박스')).toEqual({ quantity: 5, unit: '박스' });
  expect(parseQty('8')).toEqual({ quantity: 8 });
  expect(parseQty('')).toEqual({ quantity: null });
  expect(parseQty('10킬로')).toBeNull();
});
