package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;
import java.util.List;

@Getter
@Builder
public class DesignGenerateResponseDto {
    private Long designId;
    private String status;
    private String generatedPrompt;
    private List<String> imageUrls; //디자인 이미지 사진 3장
    private Details details;

    @Getter
    @Builder
    public static class Details {
        private List<String> colorPalette; // ComfyUI 컬러 워크플로우가 뽑은 hex 리스트
        private List<String> textures;     // (아직 미구현 - 빈 배열)
        private List<String> nailParts;    // (아직 미구현 - 빈 배열)
    }
}