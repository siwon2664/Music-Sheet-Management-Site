// 요일별 고정 예배: 일요일 = 주일예배, 수요일 = 수요예배, 금요일 = 금요철야예배
const SERVICE_BY_WEEKDAY: Record<number, string> = {
  0: '주일예배',
  3: '수요예배',
  5: '금요철야예배',
};

export function getDefaultSetlistTitle(date: string) {
  const weekday = new Date(`${date}T00:00:00`).getDay();
  return SERVICE_BY_WEEKDAY[weekday] ?? '';
}
