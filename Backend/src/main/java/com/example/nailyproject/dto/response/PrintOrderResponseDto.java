package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class PrintOrderResponseDto {
    private Long id;
    private String shapeId;
    private String shapeLabelKo;
    private Double tipExtensionMm; // null이면 길이 기록 전 예전 주문 (쉐입 기본 길이로 출력됨)
    private String status;
    private String orderedAt; // yyyy. M. d. HH:mm
    private Long leftScanId;
    private Long rightScanId;
    private String mergedModelUrl; // MERGED 상태부터 값이 있음 — 프론트에서 미리보기/확정 버튼에 사용
    private String failReason;     // FAILED 상태일 때 원인
    private Integer queueAhead;    // WAITING_IN_QUEUE일 때만 값 있음 — 내 앞에 출력 중/대기 중인 주문 수 (0이면 곧 시작)
}