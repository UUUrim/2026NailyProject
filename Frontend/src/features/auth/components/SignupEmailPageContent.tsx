import { AuthSplitLayout } from '@/features/auth/components/AuthSplitLayout'
import { getPasswordRuleChecks } from '@/shared/utils/passwordRules'
import { LegalDocumentModal } from '@/shared/components/LegalDocumentModal'
import {
  TERMS_OF_SERVICE,
  TERMS_OF_SERVICE_UPDATED_AT,
  PRIVACY_POLICY,
  PRIVACY_POLICY_UPDATED_AT,
} from '@/shared/constants/legalDocuments'
import { useSignupEmailPage } from '@/features/auth/hooks/useSignupEmailPage'
import '@/styles/signup.css'

export function SignupEmailPageContent() {
  const {
    email,
    setEmail,
    verificationInput,
    setVerificationInput,
    emailVerified,
    password,
    setPassword,
    passwordConfirm,
    setPasswordConfirm,
    name,
    setName,
    nickname,
    setNickname,
    emailMessage,
    emailMessageType,
    codeMessage,
    codeMessageType,
    passwordMessage,
    nameMessage,
    nicknameMessage,
    formMessage,
    isCodeSending,
    isCodeVerifying,
    isSubmitting,
    legalModal,
    setLegalModal,
    handleSendCode,
    handleVerifyCode,
    handleSignup,
  } = useSignupEmailPage()

  return (
      <AuthSplitLayout>
        <section className="signup-box">
          <h1 className="signup-box__heading">이메일 가입</h1>

          <form onSubmit={(e) => void handleSignup(e)}>
            <label className="signup-box__label" htmlFor="signup-email">
              이메일
            </label>
            <div className="signup-box__email-grid">
              <input
                  id="signup-email"
                  className="signup-box__input"
                  type="email"
                  placeholder="아이디로 사용할 이메일을 입력해 주세요."
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={emailVerified}
                  autoComplete="email"
              />
              <button
                  type="button"
                  className="signup-box__inline-button"
                  onClick={() => void handleSendCode()}
                  disabled={emailVerified || isCodeSending}
              >
                {isCodeSending ? '발송 중...' : '인증코드'}
              </button>
              {emailMessage && (
                  <p className={`signup-box__field-message signup-box__field-message--grid ${emailMessageType === 'success' ? 'is-success' : 'is-error'}`}>
                    {emailMessage}
                  </p>
              )}

              <input
                  className="signup-box__input"
                  placeholder="인증코드 6자리를 입력해 주세요."
                  value={verificationInput}
                  onChange={(e) => setVerificationInput(e.target.value)}
                  maxLength={6}
                  inputMode="numeric"
                  disabled={emailVerified}
              />
              <button
                  type="button"
                  className="signup-box__inline-button"
                  onClick={() => void handleVerifyCode()}
                  disabled={emailVerified || isCodeVerifying}
              >
                {isCodeVerifying ? '확인 중...' : '인증하기'}
              </button>
              {codeMessage && (
                  <p className={`signup-box__field-message signup-box__field-message--grid ${codeMessageType === 'success' ? 'is-success' : 'is-error'}`}>
                    {codeMessage}
                  </p>
              )}
            </div>

            <label className="signup-box__label" htmlFor="signup-password">
              비밀번호
            </label>
            <input
                id="signup-password"
                className="signup-box__input"
                type="password"
                autoComplete="new-password"
                placeholder="영문 대소문자, 숫자, 특수문자를 모두 포함한 8자 이상"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
            />
            {password.length > 0 && (
                <ul className="signup-box__password-rules">
                  {getPasswordRuleChecks(password).map((rule) => (
                      <li key={rule.key} className={rule.passed ? 'is-met' : 'is-unmet'}>
                        <span aria-hidden="true">{rule.passed ? '✓' : '✕'}</span>
                        {rule.label}
                      </li>
                  ))}
                </ul>
            )}
            <input
                className="signup-box__input"
                type="password"
                autoComplete="new-password"
                placeholder="비밀번호를 한 번 더 입력해 주세요."
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
            />
            {passwordMessage && <p className="signup-box__field-message is-error">{passwordMessage}</p>}

            <label className="signup-box__label signup-box__label--section" htmlFor="signup-name">
              이름
            </label>
            <input
                id="signup-name"
                className="signup-box__input"
                placeholder="본명을 입력해 주세요."
                value={name}
                onChange={(e) => setName(e.target.value)}
            />
            {nameMessage && <p className="signup-box__field-message is-error">{nameMessage}</p>}

            <label className="signup-box__label signup-box__label--section" htmlFor="signup-nickname">
              닉네임
            </label>
            <input
                id="signup-nickname"
                className="signup-box__input"
                placeholder="한글, 영문, 숫자 2-20자"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
            />
            {nicknameMessage && <p className="signup-box__field-message is-error">{nicknameMessage}</p>}

            {formMessage && <p className="signup-box__status">{formMessage}</p>}

            <button
                type="submit"
                className="signup-box__submit"
                disabled={isSubmitting}
            >
              {isSubmitting ? '가입 중...' : '가입하기'}
            </button>
          </form>

          <p className="signup-box__notice">
            가입하기를 클릭함으로써,{' '}
            <button type="button" className="signup-box__notice-link" onClick={() => setLegalModal('terms')}>
              이용약관
            </button>
            {' '}및{' '}
            <button type="button" className="signup-box__notice-link" onClick={() => setLegalModal('privacy')}>
              개인정보 처리방침
            </button>
            에 동의하는 것으로 간주됩니다
          </p>
        </section>

        {legalModal === 'terms' && (
            <LegalDocumentModal
                title="이용약관"
                updatedAt={TERMS_OF_SERVICE_UPDATED_AT}
                sections={TERMS_OF_SERVICE}
                onClose={() => setLegalModal(null)}
            />
        )}
        {legalModal === 'privacy' && (
            <LegalDocumentModal
                title="개인정보 처리방침"
                updatedAt={PRIVACY_POLICY_UPDATED_AT}
                sections={PRIVACY_POLICY}
                onClose={() => setLegalModal(null)}
            />
        )}
      </AuthSplitLayout>
  )
}
