package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;

import java.util.List;

// 마이페이지 '손 분석 결과 이력' 목록용 요약 DTO
@Getter
@Builder
public class ScanHistoryItemDto {
    private Long scanId;
    private String handSide;
    private String status;
    private String shape;
    private String recommendedShape;
    private String skinToneHex;
    private List<String> recommendedColors;
    private String tone;
    private Double warmness;
    private Double brightness;
    private Double saturation;
    private Double avgLengthMm;
    private Double avgWidthMm;
    private Double avgCurve;
    private String scannedAt; // yyyy. M. d. HH:mm:ss
}
