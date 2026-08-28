import { getPasswordRuleChecks, isPasswordValid } from '@/shared/utils/passwordRules'
import { PageHeader } from '@/features/mypage/components/PageHeader'
import { useMyPageContext } from '../context'

export function ProfileTab() {
  const {
    profile,
    isSocialLogin,
    totalScanCount,
    totalPrintCount,
    totalDesignCount,
    listSortOrder,
    setListSortOrder,
    isEditingNickname,
    isEditingPassword,
    handleStartEditNickname,
    handleStartEditPassword,
    nicknameStage,
    nicknamePassword,
    setNicknamePassword,
    nicknamePasswordError,
    handleCloseNicknameForm,
    handleVerifyNicknamePassword,
    isVerifyingNicknamePassword,
    nickname,
    setNickname,
    nicknameError,
    handleSaveNickname,
    isSavingNickname,
    passwordStage,
    currentPassword,
    setCurrentPassword,
    currentPasswordError,
    handleClosePasswordForm,
    handleVerifyCurrentPassword,
    isVerifyingCurrentPassword,
    newPassword,
    setNewPassword,
    passwordConfirm,
    setPasswordConfirm,
    newPasswordSubmitError,
    handleSavePassword,
    isSavingPassword,
  } = useMyPageContext()

  return (
      <section className="mypage-x__panel">
        <PageHeader
            id="profile"
            nickname={profile?.nickname}
            totalScanCount={totalScanCount}
            totalPrintCount={totalPrintCount}
            totalDesignCount={totalDesignCount}
            listSortOrder={listSortOrder}
            onChangeSort={setListSortOrder}
        />
        <div className="mypage-x__profile-card">
          <div className="mypage-x__avatar mypage-x__avatar--lg" aria-hidden="true">
            {profile?.nickname.charAt(0) ?? '?'}
          </div>
          <div className="mypage-x__profile-body">
            <h2>{profile?.nickname ?? '-'}</h2>
            <p>{profile?.email ?? '-'}</p>
            <p className="mypage-x__muted">{profile?.name ?? '-'}</p>

            {!isEditingNickname && !isEditingPassword && (
                <div className="mypage-x__profile-actions">
                  <button type="button" className="mypage-x__edit-btn" onClick={handleStartEditNickname}>
                    닉네임 변경
                  </button>
                  {/* 소셜 로그인 계정은 자체 비밀번호가 없어 비밀번호 변경을 노출하지 않는다 */}
                  {!isSocialLogin && (
                      <button type="button" className="mypage-x__edit-btn" onClick={handleStartEditPassword}>
                        비밀번호 변경
                      </button>
                  )}
                </div>
            )}

            {isEditingNickname && (
                <div className="mypage-x__edit-form">
                  {nicknameStage === 'password' && (
                      <>
                        <label>
                          현재 비밀번호
                          <input
                              type="password"
                              value={nicknamePassword}
                              onChange={(e) => setNicknamePassword(e.target.value)}
                              placeholder="본인 확인을 위해 입력해 주세요"
                              autoComplete="current-password"
                          />
                        </label>
                        {nicknamePasswordError && (
                            <p className="mypage-x__field-error">{nicknamePasswordError}</p>
                        )}
                        <div className="mypage-x__edit-actions">
                          <button type="button" onClick={handleCloseNicknameForm}>
                            취소
                          </button>
                          <button
                              type="button"
                              className="primary"
                              onClick={() => void handleVerifyNicknamePassword()}
                              disabled={isVerifyingNicknamePassword}
                          >
                            {isVerifyingNicknamePassword ? '확인 중...' : '확인'}
                          </button>
                        </div>
                      </>
                  )}

                  {nicknameStage === 'nickname' && (
                      <>
                        <label>
                          새 닉네임
                          <input value={nickname} onChange={(e) => setNickname(e.target.value)} autoFocus />
                        </label>
                        {nicknameError && <p className="mypage-x__field-error">{nicknameError}</p>}
                        <div className="mypage-x__edit-actions">
                          <button type="button" onClick={handleCloseNicknameForm}>
                            취소
                          </button>
                          <button
                              type="button"
                              className="primary"
                              onClick={() => void handleSaveNickname()}
                              disabled={isSavingNickname || !nickname.trim()}
                          >
                            {isSavingNickname ? '저장 중...' : '저장'}
                          </button>
                        </div>
                      </>
                  )}

                  {nicknameStage === 'done' && (
                      <>
                        <p className="mypage-x__field-hint is-ok">닉네임이 변경되었습니다.</p>
                        <div className="mypage-x__edit-actions">
                          <button type="button" className="primary" onClick={handleCloseNicknameForm}>
                            확인
                          </button>
                        </div>
                      </>
                  )}
                </div>
            )}

            {isEditingPassword && (
                <div className="mypage-x__edit-form">
                  {passwordStage === 'password' && (
                      <>
                        <label>
                          현재 비밀번호
                          <input
                              type="password"
                              value={currentPassword}
                              onChange={(e) => setCurrentPassword(e.target.value)}
                              autoComplete="current-password"
                          />
                        </label>
                        {currentPasswordError && (
                            <p className="mypage-x__field-error">{currentPasswordError}</p>
                        )}
                        <div className="mypage-x__edit-actions">
                          <button type="button" onClick={handleClosePasswordForm}>
                            취소
                          </button>
                          <button
                              type="button"
                              className="primary"
                              onClick={() => void handleVerifyCurrentPassword()}
                              disabled={isVerifyingCurrentPassword}
                          >
                            {isVerifyingCurrentPassword ? '확인 중...' : '확인'}
                          </button>
                        </div>
                      </>
                  )}

                  {passwordStage === 'new' && (
                      <>
                        <label>
                          새 비밀번호
                          <input
                              type="password"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              autoComplete="new-password"
                              autoFocus
                          />
                        </label>
                        <ul className="mypage-x__password-rules">
                          {getPasswordRuleChecks(newPassword).map((rule) => (
                              <li key={rule.key} className={rule.passed ? 'is-met' : 'is-unmet'}>
                                <span aria-hidden="true">{rule.passed ? '✓' : '✕'}</span>
                                {rule.label}
                              </li>
                          ))}
                        </ul>

                        <label>
                          새 비밀번호 확인
                          <input
                              type="password"
                              value={passwordConfirm}
                              onChange={(e) => setPasswordConfirm(e.target.value)}
                              autoComplete="new-password"
                          />
                        </label>
                        {passwordConfirm.length > 0 && (
                            <p
                                className={`mypage-x__field-hint ${
                                    newPassword === passwordConfirm ? 'is-ok' : 'is-error'
                                }`}
                            >
                              {newPassword === passwordConfirm ? '비밀번호가 일치합니다.' : '비밀번호가 일치하지 않습니다.'}
                            </p>
                        )}
                        {newPasswordSubmitError && (
                            <p className="mypage-x__field-error">{newPasswordSubmitError}</p>
                        )}

                        <div className="mypage-x__edit-actions">
                          <button type="button" onClick={handleClosePasswordForm}>
                            취소
                          </button>
                          <button
                              type="button"
                              className="primary"
                              onClick={() => void handleSavePassword()}
                              disabled={isSavingPassword || !isPasswordValid(newPassword) || newPassword !== passwordConfirm}
                          >
                            {isSavingPassword ? '변경 중...' : '변경'}
                          </button>
                        </div>
                      </>
                  )}

                  {passwordStage === 'done' && (
                      <>
                        <p className="mypage-x__field-hint is-ok">비밀번호가 변경되었습니다.</p>
                        <div className="mypage-x__edit-actions">
                          <button type="button" className="primary" onClick={handleClosePasswordForm}>
                            확인
                          </button>
                        </div>
                      </>
                  )}
                </div>
            )}
          </div>
        </div>
      </section>
  )
}
