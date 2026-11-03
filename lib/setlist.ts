// 요일별 고정 예배: 일요일 = 주일예배, 수요일 = 수요예배, 금요일 = 금요철야예배
const SERVICE_BY_WEEKDAY: Record<number, string> = {
  0: '주일예배',
  3: '수요예배',
  5: '금요철야예배',
};

// 곡 제목 끝의 "A Key", "Bb Key", "Akey" 같은 표기에서 Key를 읽는다. sheets.key가 비어 있는 곡이 많다.
export function keyFromTitle(title: string): string | null {
  return /(?:^|[\s(])([A-G](?:#|b)?m?)\s*[Kk]ey\b/.exec(title)?.[1] ?? null;
}

export function getDefaultSetlistTitle(date: string) {
  const weekday = new Date(`${date}T00:00:00`).getDay();
  return SERVICE_BY_WEEKDAY[weekday] ?? '';
}
