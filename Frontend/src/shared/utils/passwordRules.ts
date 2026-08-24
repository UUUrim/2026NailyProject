// 마이페이지 비밀번호 변경과 회원가입에서 공통으로 쓰는 비밀번호 조건 체크 로직.
export type PasswordRuleCheck = { key: string; label: string; passed: boolean }

export function getPasswordRuleChecks(pw: string): PasswordRuleCheck[] {
  return [
    { key: 'length', label: '8자 이상', passed: pw.length >= 8 },
    { key: 'upper', label: '영문 대문자 포함', passed: /[A-Z]/.test(pw) },
    { key: 'lower', label: '영문 소문자 포함', passed: /[a-z]/.test(pw) },
    { key: 'digit', label: '숫자 포함', passed: /[0-9]/.test(pw) },
    { key: 'special', label: '특수문자 포함', passed: /[^A-Za-z0-9]/.test(pw) },
  ]
}

export function isPasswordValid(pw: string): boolean {
  return getPasswordRuleChecks(pw).every((rule) => rule.passed)
}
