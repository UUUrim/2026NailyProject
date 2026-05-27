package com.example.nailyproject.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;


@Entity
@Table(name = "hand_scans")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@Builder
public class HandScan {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id", nullable = false)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Enumerated(EnumType.STRING)
    @Column(name = "hand_side", nullable = false)
    private HandSide handSide;

    // 분석 상태
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    @Builder.Default
    private ScanStatus status = ScanStatus.PENDING;

    // 분석 결과
    @Column(name = "shape", length = 50)
    private String shape; // 손가락 형태 (almond, round 등)

    @Column(name = "skin_tone_hex", length = 10)
    private String skinToneHex; // 피부톤 HEX

    @Column(name = "recommended_colors", columnDefinition = "JSON")
    private String recommendedColors; // 추천 색상 JSON 배열

    @CreationTimestamp
    @Column(name = "scanned_at", nullable = false, updatable = false)
    private LocalDateTime scannedAt;

    public enum HandSide {
        LEFT, RIGHT
    }

    public enum ScanStatus {
        PENDING,    // 분석 대기
        ANALYZING,  // 분석 중
        COMPLETED,  // 분석 완료
        FAILED      // 분석 실패
    }

    // 분석 시작
    public void startAnalyzing() {
        this.status = ScanStatus.ANALYZING;
    }

    // 분석 결과 저장
    public void updateAnalysisResult(String shape, String skinToneHex, String recommendedColors) {
        this.shape = shape;
        this.skinToneHex = skinToneHex;
        this.recommendedColors = recommendedColors;
        this.status = ScanStatus.COMPLETED;
    }

    // 분석 실패
    public void failAnalysis() {
        this.status = ScanStatus.FAILED;
    }
}