import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import 'dayjs/locale/ko';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('ko');
dayjs.tz.setDefault('Asia/Seoul');

export const TZ = 'Asia/Seoul';

/** 오늘 (Asia/Seoul 기준) YYYY-MM-DD */
export const seoulToday = () => dayjs().tz(TZ).format('YYYY-MM-DD');
export const seoulNow = () => dayjs().tz(TZ);

export const fmtDate = (d: string) => dayjs(d).format('M/D (dd)');
export const fmtLong = (d: string) => dayjs(d).format('M월 D일 (dd)');
export const fmtStamp = (iso: string | undefined) => (iso ? dayjs(iso).tz(TZ).format('M/D HH:mm') : '');

export { dayjs };
