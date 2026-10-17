package com.example.nailyproject.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "design_sessions")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@Builder

// 사용자의 디자인 요청 과정을 담는 세션
// 선택지, 자유입력 키워드, 최종 프롬프트 저장
// 채팅/선택 단계

public class DesignSession {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id", nullable = false)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "hand_scan_id", nullable = true) //false ->true변경
    private HandScan handScan;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    @Builder.Default
    private SessionStatus status = SessionStatus.IN_PROGRESS;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "extracted_preferences", columnDefinition = "JSON")
    private String extractedPreferences; // JSON 형태로 저장

    @Column(name = "finger_overrides", columnDefinition = "JSON")
    private String fingerOverrides;

    @Column(name = "finger_dislikes", columnDefinition = "JSON")
    private String fingerDislikes;

    public enum SessionStatus {
        IN_PROGRESS, COMPLETED, CANCELLED
    }

    @Column(name = "generated_prompt", columnDefinition = "TEXT")
    private String generatedPrompt;

    @Column(name = "refine_keywords", columnDefinition = "JSON")
    private String refineKeywords; // 자유입력 키워드 JSON 배열

    @Column(name = "reference_image_url")
    private String referenceImageUrl; // 사진 기반 흐름에서 최초 업로드한 참고 이미지 S3 URL — 재생성 시 재사용

    // ── 디자인 채팅 사이드바의 채팅 이력 ──
    // 채팅 화면 상태 그대로 (말풍선·선택 창·진행 단계 등, 프론트가 만든 JSON) — 이력에서 이 채팅을 다시 열면 그대로 이어서 한다.
    // 사용자가 한 번이라도 말한 채팅만 저장되고, 저장된 적 없는 세션(인사만 보고 나간 채팅)은 이력에 나오지 않는다.
    @Column(name = "chat_state", columnDefinition = "LONGTEXT")
    private String chatState;

    // 채팅 이름 — 그 채팅에서 만든 네일 분위기로 자동으로 짓고, 사용자가 직접 바꾸면 그 뒤로는 자동으로 바꾸지 않는다
    @Column(name = "title", length = 100)
    private String title;

    @Column(name = "title_edited")
    private Boolean titleEdited;

    // 이 채팅에 반영한 손 분석 기록 (ScanSessionDto.key = "{왼손scanId}-{오른손scanId}") — 이력을 분석 기록별로 묶는다
    @Column(name = "scan_key", length = 64)
    private String scanKey;

    // 마지막으로 채팅을 저장한 시각 — 이력 정렬용
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    public void updateChatState(String chatState, String scanKey) {
        this.chatState = chatState;
        this.scanKey = scanKey;
        this.updatedAt = LocalDateTime.now();
    }

    /** 자동으로 지은 이름 — 사용자가 직접 바꾼 이름은 덮어쓰지 않는다 */
    public void updateAutoTitle(String title) {
        if (Boolean.TRUE.equals(this.titleEdited)) return;
        this.title = title;
    }

    /** 사용자가 직접 바꾼 이름 */
    public void renameTitle(String title) {
        this.title = title;
        this.titleEdited = true;
    }

    /**
     * 채팅 이력에서 지운다 — 채팅 화면 상태·이름·반영 기록만 비워 사이드바 이력과 검색에서 빠지게 한다.
     * 세션 자체(GPT 대화 기록, 이 세션으로 만든 디자인과 그 채팅 이력)는 마이페이지 등에서 쓰므로 그대로 둔다.
     */
    public void clearChatHistory() {
        this.chatState = null;
        this.title = null;
        this.titleEdited = null;
        this.scanKey = null;
    }

    public void updateRefineKeywords(String refineKeywords) {
        this.refineKeywords = refineKeywords;
    }

    public void updateReferenceImageUrl(String referenceImageUrl) {
        this.referenceImageUrl = referenceImageUrl;
    }

    public void updateExtractedPreferences(String extractedPreferences) {
        this.extractedPreferences = extractedPreferences;
    }

    public void updateFingerOverrides(String fingerOverrides) {
        this.fingerOverrides = fingerOverrides;
    }

    public void updateFingerDislikes(String fingerDislikes) {
        this.fingerDislikes = fingerDislikes;
    }

    public void updateStatus(SessionStatus status) {
        this.status = status;
    }

    public void updateGeneratedPrompt(String generatedPrompt) {
        this.generatedPrompt = generatedPrompt;
    }
}