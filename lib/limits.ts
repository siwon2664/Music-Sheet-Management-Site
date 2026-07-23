// 베타 테스트 기간 동안의 임시 제한. 정식 오픈 시 재검토.
export const MAX_SHEETS_PER_TEAM = 50;

export const SHEET_LIMIT_MESSAGE = `베타 테스트 기간 동안 팀당 악보는 최대 ${MAX_SHEETS_PER_TEAM}개까지 등록할 수 있습니다.`;

// '다드림교회'는 실사용 중인 팀이라 이 제한에서 제외한다 (DB 트리거의 예외와 동일하게 맞춤 — supabase/migrations/20260723020000_sheet_count_limit.sql).
const SHEET_LIMIT_EXEMPT_TEAM_NAMES = ['다드림교회'];

export function isExemptFromSheetLimit(teamName: string): boolean {
  return SHEET_LIMIT_EXEMPT_TEAM_NAMES.includes(teamName);
}
