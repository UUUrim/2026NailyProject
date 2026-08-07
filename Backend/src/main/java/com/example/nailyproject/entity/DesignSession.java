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

    public void updateRefineKeywords(String refineKeywords) {
        this.refineKeywords = refineKeywords;
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