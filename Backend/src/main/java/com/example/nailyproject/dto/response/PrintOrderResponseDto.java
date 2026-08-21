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
    private String mergedModelUrl; // MERGED 상태부터 값이 있음 — 프론트에서 미리보기/확정 버튼에 사용
    private String failReason;     // FAILED 상태일 때 원인
}