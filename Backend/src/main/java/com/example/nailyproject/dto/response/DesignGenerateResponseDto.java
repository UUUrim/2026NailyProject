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

    @Getter
    @Builder
    public static class Details {
        private List<String> colorPalette; // detect 서버가 뽑은 hex 리스트
        private List<String> textures;     // designPlan에서 추출한 텍스처 키
        private List<Object> nailParts;
        private Map<String, String> swatches; // ★ 신규: { "glitter": "S3_URL", ... } — 비동기 생성이라 초기엔 null
    }
}