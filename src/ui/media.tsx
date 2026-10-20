// 사진 업로드(자동 압축 → Supabase Storage), 주소 검색, 현재 위치, 길찾기·전화 링크
import { useEffect, useState } from 'react';
import { newId } from '../domain/index.ts';
import { supabase } from '../data/supabase.ts';

export async function compressAndUpload(file: File, folder: string): Promise<string> {
  const imageCompression = (await import('browser-image-compression')).default;
  const small = await imageCompression(file, { maxSizeMB: 0.4, maxWidthOrHeight: 1600, useWebWorker: true });
  if (!supabase) {
    // 데모 모드: 이 기기에만 data URL 로 저장
    return await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsDataURL(small);
    });
  }
  const path = `${folder}/${newId()}.jpg`;
  const { error } = await supabase.storage.from('photos').upload(path, small, { contentType: 'image/jpeg' });
  if (error) throw error;
  return path;
}

export function usePhotoUrl(path: string) {
  const [url, setUrl] = useState(path.startsWith('data:') ? path : '');
  useEffect(() => {
    if (path.startsWith('data:') || !supabase) return;
    let alive = true;
    supabase.storage.from('photos').createSignedUrl(path, 3600).then(({ data }) => alive && data && setUrl(data.signedUrl));
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}

export function Photo({ path, onClick }: { path: string; onClick?: (url: string) => void }) {
  const url = usePhotoUrl(path);
  return url ? <img src={url} onClick={() => onClick?.(url)} alt="" loading="lazy" /> : <div style={{ aspectRatio: '1', background: '#eee', borderRadius: 8 }} />;
}

declare global {
  interface Window {
    daum?: { Postcode: new (o: { oncomplete: (d: { roadAddress: string; jibunAddress: string; buildingName: string }) => void }) => { open: () => void } };
  }
}

/** 다음(카카오) 우편번호 서비스로 주소 검색 */
export async function searchAddress(): Promise<string | null> {
  if (!window.daum?.Postcode) {
    await new Promise<void>((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      s.onload = () => res();
      s.onerror = () => rej(new Error('주소 검색을 불러오지 못했습니다 (인터넷 연결 확인)'));
      document.head.appendChild(s);
    });
  }
  return new Promise((res) => {
    new window.daum!.Postcode({
      oncomplete: (d) => res(d.roadAddress || d.jibunAddress),
    }).open();
  });
}

const KAKAO_KEY = import.meta.env.VITE_KAKAO_REST_KEY as string | undefined;

/** 주소 → 좌표 (카카오 REST 키가 있을 때만) */
export async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!KAKAO_KEY) return null;
  const r = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`, {
    headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
  });
  const j = await r.json();
  const d = j.documents?.[0];
  return d ? { lat: Number(d.y), lng: Number(d.x) } : null;
}

/** 현재 위치 → (좌표, 주소) */
export async function currentLocation(): Promise<{ lat: number; lng: number; address: string }> {
  const pos = await new Promise<GeolocationPosition>((res, rej) =>
    navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 15000 }),
  );
  const { latitude: lat, longitude: lng } = pos.coords;
  let address = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  if (KAKAO_KEY) {
    const r = await fetch(`https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${lng}&y=${lat}`, {
      headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
    });
    const d = (await r.json()).documents?.[0];
    address = d?.road_address?.address_name ?? d?.address?.address_name ?? address;
  }
  return { lat, lng, address };
}

export function navLinks(name: string, address: string, lat: number | null, lng: number | null) {
  const n = encodeURIComponent(name || address);
  const a = encodeURIComponent(address);
  const has = lat != null && lng != null;
  return {
    kakao: has ? `https://map.kakao.com/link/to/${n},${lat},${lng}` : `https://map.kakao.com/link/search/${a}`,
    tmap: has ? `tmap://route?goalname=${n}&goalx=${lng}&goaly=${lat}` : `tmap://search?name=${a}`,
    naver: has
      ? `nmap://route/car?dlat=${lat}&dlng=${lng}&dname=${n}&appname=kr.gyeongmin.dispatch`
      : `nmap://search?query=${a}&appname=kr.gyeongmin.dispatch`,
    naverWeb: `https://map.naver.com/p/search/${a}`,
  };
}

export function NavButtons({ name, address, lat, lng }: { name: string; address: string; lat: number | null; lng: number | null }) {
  if (!address && lat == null) return null;
  const l = navLinks(name, address, lat, lng);
  return (
    <div className="row wrap" style={{ marginTop: 6 }}>
      <a href={l.kakao} target="_blank" rel="noreferrer"><button>🗺 카카오맵</button></a>
      <a href={l.tmap}><button>🚗 T맵</button></a>
      <a href={l.naver} onClick={(e) => { if (!/Android|iPhone|iPad/i.test(navigator.userAgent)) { e.preventDefault(); window.open(l.naverWeb, '_blank'); } }}><button>🧭 네이버 지도</button></a>
    </div>
  );
}

export function CallButton({ name, phone }: { name: string; phone: string }) {
  if (!phone) return null;
  return <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}><button>📞 {name || '전화'} {phone}</button></a>;
}
