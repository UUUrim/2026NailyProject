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

    @CreationTimestamp
    @Column(name = "ordered_at", nullable = false, updatable = false)
    private LocalDateTime orderedAt;

    public enum PrintStatus {
        QUEUED, PRINTING, COMPLETED
    }

    public void updateStatus(PrintStatus status) {
        this.status = status;
    }
}