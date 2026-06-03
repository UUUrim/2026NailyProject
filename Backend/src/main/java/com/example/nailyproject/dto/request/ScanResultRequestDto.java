package com.example.nailyproject.dto.request;

import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.List;

@Getter
@NoArgsConstructor
public class ScanResultRequestDto {

    private String overallSize; //평균관련해서 손톱 크기
    private String shape;    // 추천하는 초기 쉐입
    private String skinToneHex;
    private List<String> recommendedColors;
    private List<FingerResult> fingers;

    @Getter
    @NoArgsConstructor
    public static class FingerResult {
        private String finger;                  // THUMB, INDEX, MIDDLE, RING, PINKY
        private NailMeasurements measurements;  // nail_measurements.json
        private String size;                    // 개별 손가락 팁 size
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