package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;

import java.util.List;

// 마이페이지 '손 분석 결과 이력' 목록용 요약 DTO
@Getter
@Builder
public class ScanHistoryItemDto {
    private Long scanId;
    private Long pairedScanId; // 같은 스캔에서 짝으로 찍은 반대 손의 scanId (예전 스캔/짝 전이면 null)
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
    private Double avgFreeEdgeMm; // 손톱이 손가락 끝보다 나와 있는 평균 길이(mm) - 출력 화면 "내 손톱 끝" 위치용, 예전 스캔은 null
    private String scannedAt; // yyyy. M. d. HH:mm:ss
}
