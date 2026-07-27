package com.example.nailyproject.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;
import java.util.List;

// 실제 생성된 디자인 결과물
// 이미지 URL, 사용된 AI 모델, 상태 저장
// 이미지 생성 결과

@Entity
@Table(name = "nail_designs")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@Builder
public class NailDesign {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id", nullable = false)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "session_id")
    private DesignSession session; // 이 디자인이 만들어진 챗봇 세션 (없을 수도 있음, nullable)

    @ElementCollection
    @CollectionTable(name = "nail_design_images", joinColumns = @JoinColumn(name = "nail_design_id"))
    @Column(name = "image_url", nullable = false, length = 500)
    private List<String> imageUrls;

    @Column(name = "prompt_summary", columnDefinition = "TEXT")
    private String promptSummary;

    @Column(name = "ai_model", nullable = false, length = 500)
    private String aiModel;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private DesignStatus status;

    @CreationTimestamp
    @Column(name = "generated_at", nullable = false, updatable = false)
    private LocalDateTime generatedAt;

    public enum DesignStatus {
        DRAFT, CONFIRMED, IN_PRODUCTION, COMPLETED
    }

    @Column(name = "design_plan", columnDefinition = "JSON")
    private String designPlan; // STEP3에서 생성된 5개 손가락 상세 디자인 JSON 원문

    public void updateImageUrls(List<String> imageUrls) {
        this.imageUrls = imageUrls;
    }

    public void updateStatus(DesignStatus status) {
        this.status = status;
    }

    public void updateDesignPlan(String designPlan) {
        this.designPlan = designPlan;
    }
}