/** 칸 글자가 길면 앞 4글자 + "…" */
export function abbrev(s: string | null | undefined, n = 4): string {
  if (!s) return '';
  const chars = [...s];
  return chars.length > n ? chars.slice(0, n).join('') + '…' : s;
}

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

export function chosung(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 0xac00;
    out += c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch;
  }
  return out;
}

const isChosungOnly = (q: string) => /^[ㄱ-ㅎ\s]+$/.test(q);

/** 한글 초성 검색 지원: "ㄷㄷ" → 대동, 일반 검색은 부분 일치 */
export function matchSearch(text: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  if (isChosungOnly(q)) return chosung(t).replace(/\s/g, '').includes(q.replace(/\s/g, ''));
  // 섞인 검색: "대ㄷ" → 글자별로 초성 또는 일치
  const tc = [...t];
  const qc = [...q];
  outer: for (let i = 0; i + qc.length <= tc.length; i++) {
    for (let j = 0; j < qc.length; j++) {
      const a = tc[i + j];
      const b = qc[j];
      if (a !== b && chosung(a) !== b) continue outer;
    }
    return true;
  }
  return false;
}

