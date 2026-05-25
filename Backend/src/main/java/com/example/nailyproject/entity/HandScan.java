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

    @Column(name = "scan_file_url", nullable = false, length = 500)
    @Builder.Default
    private String scanFileUrl = ""; // 스캔 시작 시 임시값, 이미지 업로드 후 업데이트

    @Enumerated(EnumType.STRING)
    @Column(name = "hand_side", nullable = false)
    private HandSide handSide;

    @CreationTimestamp
    @Column(name = "scanned_at", nullable = false, updatable = false)
    private LocalDateTime scannedAt;

    public enum HandSide {
        LEFT, RIGHT
    }

    // 이미지 업로드 후 URL 업데이트
    public void updateScanFileUrl(String scanFileUrl) {
        this.scanFileUrl = scanFileUrl;
    }
}
