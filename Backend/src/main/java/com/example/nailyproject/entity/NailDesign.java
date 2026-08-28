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

    @Column(name = "color_palette", columnDefinition = "JSON")
    private String colorPalette; // detect 서버(colors_per_nail)가 뽑아낸 hex 리스트 JSON 배열, 예: ["#FDE2EA", "#DE869F"]

    // ★ 신규: detect 서버(parts, segment_prompt="nail tips")가 생성 시점에 뽑아낸 손가락별
    // (엄지~새끼, 왼쪽부터) 매트 이미지 S3 URL 5개. AR 미리보기가 로컬 세그멘테이션 대신 이걸
    // 우선 사용한다 - 실패했거나 이 기능 이전에 만들어진 디자인은 null.
    @Column(name = "nail_tip_crops", columnDefinition = "JSON")
    private String nailTipCropsJson;

    // ★ 신규 추가: 텍스처 스와치 생성 결과를 JSON으로 저장
    // 형식: {"glitter": "<S3 URL>", "plain_solid": "<S3 URL>", ...}
    // S3에 업로드 후 URL을 저장한다 (base64 raw는 너무 커서 DB에 저장 부적합)
    @Column(name = "swatches_json", columnDefinition = "JSON")
    private String swatchesJson;

    // ★ 추가: 이미지 생성 시 사용한 seed (inpaint 때 동일 seed 재사용 필요)
    @Column(name = "seed")
    private Long seed;

    @Column(name = "reference_image_url")
    private String referenceImageUrl; // 사진 기반 생성일 때, 사용자가 업로드한 원본 참고 이미지 S3 URL (채팅 이력 재연용)

    /** 메인 '둘러보기' 갤러리에 공개 공유 여부 */
    @Column(name = "is_shared", nullable = false)
    @Builder.Default
    private boolean shared = false;

    @Column(name = "shared_at")
    private LocalDateTime sharedAt;

    @Column(name = "parts_json", columnDefinition = "JSON")
    private String partsJson; // {"silver star": ["S3_URL1", ...], "pearl": [...]}

    public void updatePartsJson(String partsJson) {
        this.partsJson = partsJson;
    }

    public void updateImageUrls(List<String> imageUrls) {
        this.imageUrls = imageUrls;
    }

    public void updateStatus(DesignStatus status) {
        this.status = status;
    }

    public void updateDesignPlan(String designPlan) {
        this.designPlan = designPlan;
    }

    public void updateColorPalette(String colorPalette) {
        this.colorPalette = colorPalette;
    }

    public void updateNailTipCropsJson(String nailTipCropsJson) {
        this.nailTipCropsJson = nailTipCropsJson;
    }

    // ★ 신규 추가
    public void updateSwatchesJson(String swatchesJson) {
        this.swatchesJson = swatchesJson;
    }

    // setter 추가
    public void updateSeed(Long seed) {
        this.seed = seed;
    }

    public void updateReferenceImageUrl(String referenceImageUrl) {
        this.referenceImageUrl = referenceImageUrl;
    }

    public void share() {
        this.shared = true;
        this.sharedAt = LocalDateTime.now();
    }

    public void unshare() {
        this.shared = false;
        this.sharedAt = null;
    }
}