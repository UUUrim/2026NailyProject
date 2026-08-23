package com.example.nailyproject.dto.request;

import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.List;

@Getter
@NoArgsConstructor
public class ScanResultRequestDto {

    private String overallSize; //평균관련해서 손톱 크기
    private String summaryText; // profile.json summary_text (한 줄 요약)
    private String shape;    // 추천하는 초기 쉐입
    private String skinToneHex;
    private List<String> recommendedColors;
    private String seasonCode;
    private String seasonNameKo;
    private List<FingerResult> fingers;

    @Getter
    @NoArgsConstructor
    public static class FingerResult {
        private String finger;                  // THUMB, INDEX, MIDDLE, RING, PINKY
        private String annotatedImageUrl;       // 스캔 서버가 S3에 올린 annotated 이미지 URL (A안)
        private NailMeasurements measurements;  // nail_measurements.json
        private String size;                    // 개별 손가락 팁 size
    }

    @Getter
    @NoArgsConstructor
    public static class NailMeasurements {
        private double widthMm;             // 네일 폭
        private double lengthMm;            // 네일 길이
        private double correctedLengthMm;   // 보정된 길이
        private double cCurveMm;            // 곡률 깊이
        private double arcRadiusMm;         // 곡률 반지름
        private double thicknessMm;         // 두께
        // profile.json — 논문(Yeo 2017) 기준 비교값
        private double widthVsAvgMm;        // 평균 대비 너비 편차 (mm)
        private double lengthVsAvgMm;       // 평균 대비 길이 편차 (mm)
        private String widthSize;           // much_smaller/smaller/average/larger/much_larger
        private String lengthSize;
        private String nailSize;            // 최종 종합 사이즈 분류
    }
}