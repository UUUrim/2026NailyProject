package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;

// 전체 디자인 목록용

@Getter
@Builder
public class DesignImageResponseDto {
    private Long designId;
    private String imageUrl;
    private String createdAt;
}
