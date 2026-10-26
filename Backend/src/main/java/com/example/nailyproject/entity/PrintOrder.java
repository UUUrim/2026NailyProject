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

    private static final int FAIL_REASON_MAX_LENGTH = 1000;

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

    // 출력 화면에서 사용자가 설정한 팁 연장 길이(mm) — 실측 손톱 길이에 이만큼 더해서 출력된다.
    // null이면 길이를 기록하기 전에 신청된 예전 주문 (쉐입별 기본 길이로 출력됨)
    @Column(name = "tip_extension_mm")
    private Double tipExtensionMm;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    @Builder.Default
    private PrintStatus status = PrintStatus.QUEUED;

    // printer/server.py의 /print/merge(-both) 콜백으로 받은, 병합된 3MF의 S3 URL
    @Column(name = "merged_model_url")
    private String mergedModelUrl;

    // 실패 시 원인 메시지 (프론트에 보여주기 위함)
    @Column(name = "fail_reason", length = FAIL_REASON_MAX_LENGTH)
    private String failReason;

    @CreationTimestamp
    @Column(name = "ordered_at", nullable = false, updatable = false)
    private LocalDateTime orderedAt;

    // 사용자가 마이페이지 출력 내역에서 지운 주문. 내역에서만 빠지고 행은 남긴다 - 아직 진행 중인 주문이면
    // printer 서버 콜백과 대기 순번 계산이 이 행을 계속 쓴다 (지운다고 출력이 취소되지는 않는다). null이면 지우지 않음.
    @Column(name = "history_deleted")
    private Boolean historyDeleted;

    public enum PrintStatus {
        QUEUED,     // 신청만 된 상태
        MERGING,    // printer 서버에 병합 요청 보냄, 응답 대기 중
        MERGED,     // 병합 완료 — 사용자 확인 후 /print/start를 눌러야 진짜 출력 시작
        WAITING_IN_QUEUE, //출력 대기 (큐 용)
        PRINTING,   // 슬라이싱+프린터 업로드까지 끝나서 실제 출력 중
        COMPLETED,
        FAILED,
        CANCELING,  // 취소 요청됨 - 출력 중이던 주문의 정지 명령을 보냈고 프린터가 멈추기를 기다리는 중
        CANCELED    // 사용자가 취소 (대기 중이던 주문을 빼거나, 출력 중이던 프린터가 멈춘 경우)
    }

    public void updateStatus(PrintStatus status) {
        this.status = status;
    }

    public void updateMergedModelUrl(String mergedModelUrl) {
        this.mergedModelUrl = mergedModelUrl;
    }

    public boolean isHistoryDeleted() {
        return Boolean.TRUE.equals(historyDeleted);
    }

    // 출력 내역에서 지우기
    public void deleteHistory() {
        this.historyDeleted = true;
    }

    public void updateFailReason(String failReason) {
        this.failReason = failReason != null && failReason.length() > FAIL_REASON_MAX_LENGTH
                ? failReason.substring(0, FAIL_REASON_MAX_LENGTH)
                : failReason;
    }
}