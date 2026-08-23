package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;

import java.util.List;

/** 디자인 상세 (이미지 모달 / 둘러보기 상세용) */
@Getter
@Builder
public class DesignDetailResponseDto {
    private Long designId;
    private String imageUrl;
    private String createdAt;
    private boolean shared;
    private boolean owner;
    private DesignGenerateResponseDto.Details details;
    private List<String> imageUrls;
}
