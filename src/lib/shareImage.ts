// 일정표를 이미지(PNG)로: 내려받기 · 휴대폰 공유(카카오톡 등). 공유가 안 되는 컴퓨터는 이미지 복사(카톡 PC에 붙여넣기)
// 카톡은 사진을 열면 전체를 한 화면에 맞추므로, 세로로 긴 일정표는 휴대폰 화면 비율에 맞게 여러 장으로 나눈다 (표 줄 경계에서)
import { store } from '../data/store.ts';

const PIXEL_RATIO = 3;
/** 한 장의 세로 ÷ 가로 최대 비율 (휴대폰 화면 9:19.5 에서 위아래 메뉴를 뺀 정도) */
const MAX_RATIO = 1.75;

/** 자를 수 있는 위치(이미지 위에서부터 CSS px): 표 줄 아래 · 표 사이 */
function cutPoints(el: HTMLElement): { y: number; strong: boolean }[] {
  const top = el.getBoundingClientRect().top;
  const pts = new Map<number, boolean>();
  el.querySelectorAll('tr').forEach((tr) => {
    const y = Math.round(tr.getBoundingClientRect().bottom - top);
    if (!pts.has(y)) pts.set(y, false);
  });
  el.querySelectorAll('table').forEach((t) => pts.set(Math.round(t.getBoundingClientRect().bottom - top), true));
  return [...pts.entries()].map(([y, strong]) => ({ y, strong })).sort((a, b) => a.y - b.y);
}

async function toBlobs(el: HTMLElement, label: string): Promise<Blob[]> {
  const { toCanvas } = await import('html-to-image');
  const width = el.scrollWidth;
  const height = el.scrollHeight;
  const cuts = cutPoints(el);
  // 버튼(전일·익일·공유)은 빼고, 흰 바탕 · 3배 선명하게 (휴대폰에서 확대해도 읽히게)
  const canvas = await toCanvas(el, {
    backgroundColor: '#ffffff',
    pixelRatio: PIXEL_RATIO,
    filter: (n) => !(n instanceof HTMLElement && n.tagName === 'BUTTON'),
  });
  const scale = canvas.width / width;
  const maxH = width * MAX_RATIO;
  // 나눌 구간: 장 수를 정하고 비슷한 높이로. 목표 위치 근처에서 표가 끝나는 곳을 먼저, 없으면 가까운 줄 경계
  // (조금 넘치는 정도(10%)는 한 장으로 둔다 — 아주 작은 마지막 장이 생기지 않게)
  const ranges: [number, number][] = [];
  let start = 0;
  while (height - start > maxH * 1.1) {
    const left = Math.ceil((height - start) / maxH);
    const target = start + (height - start) / left;
    const limit = start + maxH * 1.1;
    const ok = cuts.filter((c) => c.y > start + 40 && c.y <= limit);
    const near = (list: typeof ok) => list.sort((x, y) => Math.abs(x.y - target) - Math.abs(y.y - target))[0];
    const pick = near(ok.filter((c) => c.strong && Math.abs(c.y - target) <= maxH * 0.25)) ?? near([...ok]);
    const end = pick?.y ?? start + maxH;
    ranges.push([start, end]);
    start = end;
  }
  ranges.push([start, height]);
  const blobs: Blob[] = [];
  // 2장째부터는 위에 날짜 · 몇 번째 장인지 한 줄
  const headH = Math.round(30 * scale);
  for (const [i, [a, b]] of ranges.entries()) {
    const head = i > 0 ? headH : 0;
    const part = document.createElement('canvas');
    part.width = canvas.width;
    const bodyH = Math.round((b - a) * scale);
    part.height = bodyH + head;
    const ctx = part.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, part.width, part.height);
    if (head) {
      ctx.fillStyle = '#111827';
      ctx.font = `bold ${Math.round(16 * scale)}px sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(`${label} (${i + 1}/${ranges.length})`, Math.round(8 * scale), head / 2);
    }
    ctx.drawImage(canvas, 0, Math.round(a * scale), canvas.width, bodyH, 0, head, part.width, bodyH);
    const blob = await new Promise<Blob | null>((res) => part.toBlob(res, 'image/png'));
    if (!blob) throw new Error('이미지를 만들지 못했습니다');
    blobs.push(blob);
  }
  return blobs;
}

const nameOf = (base: string, i: number, n: number) => (n > 1 ? `${base} (${i + 1}-${n}).png` : `${base}.png`);

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** baseName: 확장자 없이 (여러 장이면 "(1-3)" 처럼 번호) */
export async function downloadImage(el: HTMLElement, baseName: string, label: string) {
  try {
    const blobs = await toBlobs(el, label);
    blobs.forEach((b, i) => setTimeout(() => save(b, nameOf(baseName, i, blobs.length)), i * 400));
    store.toast(blobs.length > 1 ? `이미지 ${blobs.length}장으로 나눠 저장했습니다 (휴대폰 화면 크기)` : '이미지를 저장했습니다');
  } catch (e) {
    store.toast(`이미지 저장 실패: ${(e as Error).message}`, 'warn');
  }
}

/** 휴대폰: 공유 창 → 카카오톡 선택 (여러 장 한 번에). 컴퓨터: 첫 장 복사 → 카톡 대화창에 Ctrl+V, 여러 장이면 저장 */
export async function shareImage(el: HTMLElement, baseName: string, title: string) {
  try {
    const blobs = await toBlobs(el, title);
    const files = blobs.map((b, i) => new File([b], nameOf(baseName, i, blobs.length), { type: 'image/png' }));
    if (navigator.canShare?.({ files })) {
      await navigator.share({ files, title });
      return;
    }
    if (blobs.length === 1 && navigator.clipboard && 'ClipboardItem' in window) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobs[0] })]);
        store.toast('이미지를 복사했습니다. 카카오톡 대화창에 붙여넣기(Ctrl+V) 하세요');
        return;
      } catch {
        // 복사 권한이 없으면 아래에서 저장
      }
    }
    blobs.forEach((b, i) => setTimeout(() => save(b, files[i].name), i * 400));
    store.toast(`이 기기는 바로 공유가 안 됩니다. 저장한 이미지${blobs.length > 1 ? ` ${blobs.length}장` : ''}을 카카오톡에서 보내세요`, 'warn');
  } catch (e) {
    if ((e as Error).name === 'AbortError') return; // 공유 창을 닫음
    store.toast(`공유 실패: ${(e as Error).message}`, 'warn');
  }
}
