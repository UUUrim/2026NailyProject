package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class DesignGenerateResponseDto {
    private Long designId;
    private String status;
    private String generatedPrompt;
}