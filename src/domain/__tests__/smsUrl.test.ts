import { describe, expect, it } from 'vitest';
import { smsUrl } from '../../pages/schedule/DriverTextSheet.tsx';

describe('문자로 보내기 주소', () => {
  it('번호는 숫자만, 내용은 줄바꿈까지 그대로 (안드로이드 ?body=)', () => {
    const u = smsUrl('010-1234-5678', '10/28(수) 강민수\n\n■ 오전 일정');
    expect(u.startsWith('sms:01012345678?body=')).toBe(true);
    expect(decodeURIComponent(u.split('body=')[1])).toBe('10/28(수) 강민수\n\n■ 오전 일정');
  });
});
