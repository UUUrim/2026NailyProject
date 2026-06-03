package com.example.nailyproject.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "scan_images")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@Builder
public class ScanImg {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id", nullable = false)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "scan_id", nullable = false)
    private HandScan handScan;

    @Enumerated(EnumType.STRING)
    @Column(name = "finger", nullable = false)
    private Finger finger;

    // 원본 이미지 URL
    @Column(name = "image_url", nullable = false, length = 500)
    private String imageUrl;

    // STL 파일 URL
    @Column(name = "stl_url", length = 500)
    private String stlUrl;

    // 네일 측정 결과 (nail_measurements.json → JSON으로 저장)
    @Column(name = "measurements", columnDefinition = "JSON")
    private String measurements;

    // 사이즈 분류 (profile.json의 size)
    @Column(name = "size", length = 10)
    private String size;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    public enum Finger {
        THUMB, INDEX, MIDDLE, RING, PINKY
    }

    // 분석 결과 업데이트
    public void updateAnalysisResult(String measurements, String size) {
        this.measurements = measurements;
        this.size = size;
    }

    public void updateStlUrl(String stlUrl) {
        this.stlUrl = stlUrl;
    }
}