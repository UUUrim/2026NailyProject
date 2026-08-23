package com.example.nailyproject.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

// 3D 네일팁 출력 신청 기록 (마이페이지 '네일팁 출력 내역'용)
@Entity
@Table(name = "print_orders")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@Builder
public class PrintOrder {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id", nullable = false)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    // 이 출력이 어떤 손 분석 결과를 바탕으로 신청됐는지 (없을 수도 있음)
    @Column(name = "left_scan_id")
    private Long leftScanId;

    @Column(name = "right_scan_id")
    private Long rightScanId;

    @Column(name = "shape_id", nullable = false, length = 50)
    private String shapeId;

    @Column(name = "shape_label_ko", nullable = false, length = 50)
    private String shapeLabelKo;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    @Builder.Default
    private PrintStatus status = PrintStatus.QUEUED;

    // printer/server.py의 /print/merge(-both) 콜백으로 받은, 병합된 3MF의 S3 URL
    @Column(name = "merged_model_url")
    private String mergedModelUrl;

    // 실패 시 원인 메시지 (프론트에 보여주기 위함)
    @Column(name = "fail_reason")
    private String failReason;

    @CreationTimestamp
    @Column(name = "ordered_at", nullable = false, updatable = false)
    private LocalDateTime orderedAt;

    public enum PrintStatus {
        QUEUED,     // 신청만 된 상태
        MERGING,    // printer 서버에 병합 요청 보냄, 응답 대기 중
        MERGED,     // 병합 완료 — 사용자 확인 후 /print/start를 눌러야 진짜 출력 시작
        PRINTING,   // 슬라이싱+프린터 업로드까지 끝나서 실제 출력 중
        COMPLETED,
        FAILED
    }

    public void updateStatus(PrintStatus status) {
        this.status = status;
    }

    public void updateMergedModelUrl(String mergedModelUrl) {
        this.mergedModelUrl = mergedModelUrl;
    }

    public void updateFailReason(String failReason) {
        this.failReason = failReason;
    }
}