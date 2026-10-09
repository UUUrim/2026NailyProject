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

    // 같은 스캔(한 사람의 양손 촬영)에서 짝으로 찍힌 반대 손의 scanId. 오른손을 시작할 때 프론트가 왼손 scanId를
    // 넘겨주면 서로를 가리키게 저장한다. 양손 최종 measurements.json은 이 짝으로만 만들고 읽는다
    // ("가장 최근 반대 손"을 찾아 붙이면 한 손만 찍고 멈춘 기록이나 앞 사람 손이 섞인다).
    // 짝이 정해지기 전(왼손 단독)이거나 이 필드가 생기기 전에 만든 예전 스캔은 null.
    @Column(name = "paired_scan_id")
    private Long pairedScanId;

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

    // 짝(같은 스캔의 반대 손) 연결
    public void pairWith(Long otherScanId) {
        this.pairedScanId = otherScanId;
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