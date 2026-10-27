// 일정표를 이미지(PNG)로: 내려받기 · 휴대폰 공유(카카오톡 등). 공유가 안 되는 컴퓨터는 이미지 복사(카톡 PC에 붙여넣기)
import { store } from '../data/store.ts';

async function toBlob(el: HTMLElement): Promise<Blob> {
  const { toBlob: capture } = await import('html-to-image');
  // 버튼(전일·익일·공유)은 빼고, 흰 바탕 · 3배 선명하게 (휴대폰에서 확대해도 읽히게)
  const blob = await capture(el, {
    backgroundColor: '#ffffff',
    pixelRatio: 3,
    filter: (n) => !(n instanceof HTMLElement && (n.tagName === 'BUTTON' || n.dataset.noCapture !== undefined)),
  });
  if (!blob) throw new Error('이미지를 만들지 못했습니다');
  return blob;
}

export async function downloadImage(el: HTMLElement, fileName: string) {
  try {
    const blob = await toBlob(el);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    store.toast('이미지를 저장했습니다');
  } catch (e) {
    store.toast(`이미지 저장 실패: ${(e as Error).message}`, 'warn');
  }
}

/** 휴대폰: 공유 창 → 카카오톡 선택. 컴퓨터: 이미지 복사 → 카톡 대화창에 Ctrl+V */
export async function shareImage(el: HTMLElement, fileName: string, title: string) {
  try {
    const blob = await toBlob(el);
    const file = new File([blob], fileName, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return;
    }
    if (navigator.clipboard && 'ClipboardItem' in window) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        store.toast('이미지를 복사했습니다. 카카오톡 대화창에 붙여넣기(Ctrl+V) 하세요');
        return;
      } catch {
        // 복사 권한이 없으면 아래에서 저장
      }
    }
    await downloadImage(el, fileName);
    store.toast('이 기기는 바로 공유가 안 됩니다. 저장한 이미지를 카카오톡에서 보내세요', 'warn');
  } catch (e) {
    if ((e as Error).name === 'AbortError') return; // 공유 창을 닫음
    store.toast(`공유 실패: ${(e as Error).message}`, 'warn');
  }
}
