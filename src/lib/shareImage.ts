// 일정표를 이미지(PNG)로: 내려받기 · 휴대폰 공유(카카오톡 등). 공유가 안 되는 컴퓨터는 저장
// 카톡은 사진을 열면 전체를 한 화면에 맞추므로 육지 · 제주 · 현장 3장으로 나눠 각각 크게 보이게
import { store } from '../data/store.ts';

const PIXEL_RATIO = 3;

async function toBlobs(el: HTMLElement, label: string): Promise<Blob[]> {
  const { toCanvas } = await import('html-to-image');
  const width = el.scrollWidth;
  const top = el.getBoundingClientRect().top;
  // 표(육지 · 제주 · 현장)마다 한 장씩
  const ranges = [...el.querySelectorAll('table')].map((t) => {
    const r = t.getBoundingClientRect();
    return [Math.floor(r.top - top), Math.ceil(r.bottom - top)] as [number, number];
  });
  // 버튼(전일·익일·공유)은 빼고, 흰 바탕 · 3배 선명하게 (휴대폰에서 확대해도 읽히게)
  const canvas = await toCanvas(el, {
    backgroundColor: '#ffffff',
    pixelRatio: PIXEL_RATIO,
    filter: (n) => !(n instanceof HTMLElement && n.tagName === 'BUTTON'),
  });
  const scale = canvas.width / width;
  const blobs: Blob[] = [];
  // 장마다 위에 제목 · 날짜 한 줄
  const headH = Math.round(34 * scale);
  for (const [a, b] of ranges) {
    const part = document.createElement('canvas');
    part.width = canvas.width;
    const bodyH = Math.round((b - a) * scale);
    part.height = bodyH + headH;
    const ctx = part.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, part.width, part.height);
    ctx.fillStyle = '#111827';
    ctx.font = `bold ${Math.round(18 * scale)}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(label, part.width / 2, headH / 2);
    ctx.drawImage(canvas, 0, Math.round(a * scale), canvas.width, bodyH, 0, headH, part.width, bodyH);
    const blob = await new Promise<Blob | null>((res) => part.toBlob(res, 'image/png'));
    if (!blob) throw new Error('이미지를 만들지 못했습니다');
    blobs.push(blob);
  }
  return blobs;
}

/** 육지 · 제주 · 현장 순서 */
const PART_NAMES = ['육지', '제주', '현장'];
const nameOf = (base: string, i: number) => `${base} ${PART_NAMES[i] ?? i + 1}.png`;

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** baseName: 확장자 없이 (뒤에 육지 · 제주 · 현장) */
export async function downloadImage(el: HTMLElement, baseName: string, label: string) {
  try {
    const blobs = await toBlobs(el, label);
    blobs.forEach((b, i) => setTimeout(() => save(b, nameOf(baseName, i)), i * 400));
    store.toast(`이미지 ${blobs.length}장 (육지 · 제주 · 현장) 저장했습니다`);
  } catch (e) {
    store.toast(`이미지 저장 실패: ${(e as Error).message}`, 'warn');
  }
}

/** 휴대폰: 공유 창 → 카카오톡 선택 (3장 한 번에). 컴퓨터: 바로 공유가 안 되면 3장 저장 */
export async function shareImage(el: HTMLElement, baseName: string, title: string) {
  try {
    const blobs = await toBlobs(el, title);
    const files = blobs.map((b, i) => new File([b], nameOf(baseName, i), { type: 'image/png' }));
    if (navigator.canShare?.({ files })) {
      await navigator.share({ files, title });
      return;
    }
    blobs.forEach((b, i) => setTimeout(() => save(b, files[i].name), i * 400));
    store.toast(`이 기기는 바로 공유가 안 됩니다. 저장한 이미지${blobs.length > 1 ? ` ${blobs.length}장` : ''}을 카카오톡에서 보내세요`, 'warn');
  } catch (e) {
    if ((e as Error).name === 'AbortError') return; // 공유 창을 닫음
    store.toast(`공유 실패: ${(e as Error).message}`, 'warn');
  }
}
