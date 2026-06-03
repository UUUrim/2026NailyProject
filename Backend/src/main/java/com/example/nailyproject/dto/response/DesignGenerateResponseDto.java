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
}