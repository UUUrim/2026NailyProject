package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;

// 전체 디자인 목록용

@Getter
@Builder
public class DesignImageResponseDto {
    private Long designId;
    private Long sessionId;       // 추가: 이 디자인이 만들어진 챗봇 세션 ID (없으면 null)
    private String imageUrl;
    private String promptSummary; // 추가: 이 디자인을 만들 때 쓰인 최종 프롬프트
    private String createdAt;
}