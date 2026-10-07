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
    private ScanStatus status = ScanStatus.READY;

    // 분석 값(피부톤, 추천 컬러, 추천 쉐입, 치수 등)은 DB에 저장하지 않는다.
    // 스캔 서버가 만든 로컬 최종 measurements.json을 ScanResultFileService가 읽는다.
    // (예전 컬럼 shape/recommended_shape/skin_tone_hex/recommended_colors/tone/warmness/
    //  brightness/saturation/overall_size는 테이블에 남아 있지만 더 이상 읽거나 쓰지 않는다.)

    @CreationTimestamp
    @Column(name = "scanned_at", nullable = false, updatable = false)
    private LocalDateTime scannedAt;

    public enum HandSide {
        LEFT, RIGHT
    }

    public enum ScanStatus {
        READY,           // 방 생성됨
        ANALYZING,       // 파이썬 수치 측정 중
        MEASURED,        // 수치 측정 완료
        GENERATING_STL,  // 파이썬 STL 생성 중
        COMPLETED,       // 최종 완료
        FAILED           // 실패
    }

    // 상태 변경용 범용 메서드
    public void updateStatus(ScanStatus status) {
        this.status = status;
    }

    // 분석 시작
    public void startAnalyzing() {
        this.status = ScanStatus.ANALYZING;
    }

    // 분석 실패
    public void failAnalysis() {
        this.status = ScanStatus.FAILED;
    }
}