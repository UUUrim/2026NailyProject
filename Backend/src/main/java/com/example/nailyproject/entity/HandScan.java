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

    // 분석 결과
    @Column(name = "shape", length = 50)
    private String shape; // 손가락 형태 (almond, round 등) — STL 생성/출력 시 유저가 고른 쉐입으로 덮어써질 수 있음

    // AI가 분석 직후 추천한 쉐입 — updateShape()로 덮어써지지 않고 최초 값을 그대로 보존한다.
    // (마이페이지/출력 페이지의 "추천" 배지·문구는 반드시 이 필드를 기준으로 표시해야
    // 출력 신청 후에도 추천 배지가 유저가 고른 쉐입으로 옮겨가지 않는다)
    @Column(name = "recommended_shape", length = 50)
    private String recommendedShape;

    @Column(name = "skin_tone_hex", length = 10)
    private String skinToneHex; // 피부톤 HEX

    @Column(name = "recommended_colors", columnDefinition = "JSON")
    private String recommendedColors; // 추천 색상 JSON 배열

    @Column(name = "season_code", length = 30)
    private String seasonCode; // 퍼스널컬러 16계절 코드 (e.g. spring_light)

    @Column(name = "season_name_ko", length = 30)
    private String seasonNameKo; // 퍼스널컬러 한글명 (e.g. 봄 라이트)

    @Column(name = "overall_size", length = 20)
    private String overallSize;

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

    // 분석 결과 저장
    public void updateAnalysisResult(
            String shape,
            String skinToneHex,
            String recommendedColors,
            String seasonCode,
            String seasonNameKo,
            String overallSize
    ) {
        this.shape = shape;
        this.recommendedShape = shape;
        this.skinToneHex = skinToneHex;
        this.recommendedColors = recommendedColors;
        this.seasonCode = seasonCode;
        this.seasonNameKo = seasonNameKo;
        this.overallSize = overallSize;
        this.status = ScanStatus.MEASURED;
    }

    //  프론트에서 유저가 쉐입(shape)을 선택했을 때 저장하는 용도
    public void updateShape(String shape) {
        this.shape = shape;
    }

    // 분석 실패
    public void failAnalysis() {
        this.status = ScanStatus.FAILED;
    }
}