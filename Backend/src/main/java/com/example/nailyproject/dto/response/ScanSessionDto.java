package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;

import java.util.List;

// 마이페이지/출력/디자인 채팅의 '손 분석 기록' 한 줄 = 양손 최종 measurements.json 하나.
// 파일에 이미 양손이 합쳐져 있으므로 왼손/오른손 기록을 다시 짝지을 필요가 없다.
@Getter
@Builder
public class ScanSessionDto {
    private String key;            // "{왼손scanId}-{오른손scanId}"
    private Long leftScanId;
    private Long rightScanId;
    private String scannedAt;      // yyyy. M. d. HH:mm:ss
    private String status;         // 두 손 DB 상태 중 가장 덜 끝난 것 (DB 행이 없으면 MEASURED)
    private String shape;          // = recommendedShape
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
    private Double avgFreeEdgeMm;
}
