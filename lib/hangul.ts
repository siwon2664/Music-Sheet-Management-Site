const CHOSUNG_LIST = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

// 완성형 한글 음절에서 초성만 뽑아낸다. 한글이 아닌 문자는 그대로 둔다.
export function getChosung(text: string): string {
  let result = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
      result += CHOSUNG_LIST[Math.floor((code - HANGUL_BASE) / 588)];
    } else {
      result += ch;
    }
  }
  return result;
}

export function isChosungOnly(text: string): boolean {
  return text.length > 0 && [...text].every((ch) => CHOSUNG_LIST.includes(ch));
}

// 초성만 입력된 경우 초성 매칭, 아니면 일반 부분 문자열 매칭.
export function matchesSearch(target: string, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;

  if (isChosungOnly(trimmed)) {
    return getChosung(target).includes(trimmed);
  }

  return target.toLowerCase().includes(trimmed.toLowerCase());
}
