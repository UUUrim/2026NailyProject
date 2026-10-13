package com.example.nailyproject.dto.response;

import com.example.nailyproject.entity.HandScan;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.List;

//사용자의 화면에 분석 결과를 띄워주기 위한 목적
// 스캔 상태/시각만 DB(HandScan)에서 오고, 분석 값은 로컬 최종 measurements.json에서 채워진다
// (ScanService.withFileAnalysis). 파일이 아직 없으면 분석 값은 비어 있다.

@Getter
@Builder(toBuilder = true)
public class ScanResultResponseDto {

    private Long scanId;
    private String handSide;
    private String status;

    // 분석 결과
    private String shape;            // = recommendedShape (프론트 호환용으로 남겨 둔 필드)
    private String recommendedShape;
    private String skinToneHex;
    private List<String> recommendedColors;
    private String tone;
    private Double warmness; // 웜/쿨 연속 스칼라 (tone 범주의 원본 값) — 슬라이더 위치용
    private Double brightness;
    private Double saturation;
    private String overallSize;

    // 손가락별 결과
    private List<FingerResultDto> fingers;

    private LocalDateTime scannedAt;

    @Getter
    @Builder
    public static class FingerResultDto {
        private String finger;
        private String measurements; // JSON 문자열
        private String size;
    }

    /** DB에 있는 값(상태/시각)만 담은 응답 - 분석 값은 비어 있다. */
    public static ScanResultResponseDto from(HandScan handScan) {
        return ScanResultResponseDto.builder()
                .scanId(handScan.getId())
                .handSide(handScan.getHandSide().name())
                .status(handScan.getStatus().name())
                .recommendedColors(Collections.emptyList())
                .scannedAt(handScan.getScannedAt())
                .fingers(Collections.emptyList())
                .build();
    }
}
