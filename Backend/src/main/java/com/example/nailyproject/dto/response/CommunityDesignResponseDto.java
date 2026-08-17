package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;

// 메인페이지 '둘러보기' - 전체 사용자 생성 디자인 갤러리용
// (사용자 개인정보는 노출하지 않고, 이미지와 생성일만 제공)

@Getter
@Builder
public class CommunityDesignResponseDto {
    private Long designId;
    private String imageUrl;
    private String createdAt;
    private long likeCount;
    private boolean likedByMe;
    private DesignGenerateResponseDto.Details details;
}