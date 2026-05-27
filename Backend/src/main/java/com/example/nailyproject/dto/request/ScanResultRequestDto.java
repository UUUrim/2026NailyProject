package com.example.nailyproject.dto.request;

import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.List;

@Getter
@NoArgsConstructor
public class ScanResultRequestDto {

    private List<FingerResult> fingers;         // 손가락별 결과
    private String skinToneHex;                 // 전체 피부톤 HEX
    private List<String> recommendedColors;     // 추천 색상 리스트

    @Getter
    @NoArgsConstructor
    public static class FingerResult {
        private String finger;                  // THUMB, INDEX, MIDDLE, RING, PINKY
        private String annotatedImageUrl;       // {finger}_annotated.jpg URL
        private String stlUrl;                  // nail_{finger}_{shape}.stl URL
        private NailMeasurements measurements;  // nail_measurements.json
        private String size;                    // profile.json의 size 분류
    }

    @Getter
    @NoArgsConstructor
    public static class NailMeasurements {
        private double widthMm;         // 네일 폭
        private double lengthMm;        // 네일 길이
        private double correctedLengthMm; // 보정된 길이
        private double cCurveMm;        // 곡률 깊이
        private double arcRadiusMm;     // 곡률 반지름
        private double thicknessMm;     // 두께
    }
}