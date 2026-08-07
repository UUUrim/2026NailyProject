package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class PrintOrderResponseDto {
    private Long id;
    private String shapeId;
    private String shapeLabelKo;
    private String status;
    private String orderedAt; // yyyy. M. d. HH:mm
    private Long leftScanId;
    private Long rightScanId;
}