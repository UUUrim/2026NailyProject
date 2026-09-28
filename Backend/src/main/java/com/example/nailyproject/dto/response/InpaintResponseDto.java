package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class InpaintResponseDto {

    /** S3에 저장된 결과 이미지 URL (갤러리/미리보기용) */
    private String imageUrl;

    /** 프론트 즉시 표시용 base64 (선택 사용) */
    private String imageBase64;
}