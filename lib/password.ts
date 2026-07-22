// 회원가입 시 적용하는 비밀번호 규칙:
// - 영문/숫자/특수문자 중 3가지 모두 포함
// - 공백 없이 8자 이상 32자 이하
// - 동일한 문자(숫자 포함)를 3번 이상 연속으로 사용 불가
export const PASSWORD_RULE_HINT =
  '영문·숫자·특수문자를 모두 포함해 8~32자로 입력하세요 (공백 불가, 같은 문자 3번 연속 불가)';

export function validatePassword(password: string): string | null {
  if (/\s/.test(password)) {
    return '비밀번호에는 공백을 포함할 수 없습니다.';
  }

  if (password.length < 8 || password.length > 32) {
    return '비밀번호는 8자 이상 32자 이하로 입력해주세요.';
  }

  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^a-zA-Z0-9\s]/.test(password);
  const typeCount = [hasLetter, hasNumber, hasSpecial].filter(Boolean).length;

  if (typeCount < 3) {
    return '영문, 숫자, 특수문자를 모두 포함해주세요.';
  }

  if (/(.)\1\1/.test(password)) {
    return '같은 문자를 3번 이상 연속으로 사용할 수 없습니다.';
  }

  return null;
}
