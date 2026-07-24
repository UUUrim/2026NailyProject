package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;

// 전체 디자인 목록용

@Getter
@Builder
public class DesignImageResponseDto {
    private Long designId;
    private Long sessionId; // 세션별 이력 그룹핑용 (구버전 데이터는 null일 수 있음)
    private String imageUrl;
    private String promptSummary;
    private String createdAt;
}