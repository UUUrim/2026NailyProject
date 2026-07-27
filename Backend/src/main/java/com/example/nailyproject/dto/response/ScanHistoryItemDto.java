package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;

// 마이페이지 '손 분석 결과 이력' 목록용 요약 DTO
@Getter
@Builder
public class ScanHistoryItemDto {
    private Long scanId;
    private String handSide;
    private String status;
    private String shape;
    private String seasonNameKo;
    private String scannedAt; // yyyy. M. d.
}
