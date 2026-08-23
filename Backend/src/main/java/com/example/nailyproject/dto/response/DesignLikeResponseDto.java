package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class DesignLikeResponseDto {
    private Long designId;
    private long likeCount;
    private boolean liked;
}
