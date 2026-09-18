package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;
import java.util.List;
import java.util.Map;

@Getter
@Builder
public class DesignGenerateResponseDto {
    private Long designId;
    private String status;
    private String generatedPrompt;
    private List<String> imageUrls;
    private Details details;
    private List<String> keywords;  // ★ 추가: 슬롯에서 추출한 키워드

    // 스캔 정보 기반 자동 생성(mode=scan-auto)일 때만 채워진다. 그 외에는 null.
    // 결과 화면 "내 손 분석 정보를 반영했어요"에서 추천 팔레트 중 어떤 색이 쓰였는지,
    // 어떤 무드/디자인 타입이 반영됐는지 보여주는 데 사용한다.
    private ScanAutoReflection scanAutoReflection;

    @Getter
    @Builder
    public static class Details {
        private List<String> colorPalette; // detect 서버가 뽑은 hex 리스트
        private List<String> textures;     // designPlan에서 추출한 텍스처 키
        private List<Object> nailParts;
        private Map<String, String> swatches; // ★ 신규: { "glitter": "S3_URL", ... } — 비동기 생성이라 초기엔 null
    }

    @Getter
    @Builder
    public static class ScanAutoReflection {
        private List<String> recommendedColors; // 스캔 추천 팔레트 전체 (hex, 원본 순서)
        private List<String> usedColors;        // 그 중 이번 디자인에 반영된 색 (hex)
        private String shape;                    // 반영된 네일 쉐입
        private String mood;                     // 반영된 무드 (없으면 null)
        private String designType;               // 반영된 디자인 타입 (없으면 null)
        private String motif;                    // 반영된 모티프 (없으면 null)
    }
}