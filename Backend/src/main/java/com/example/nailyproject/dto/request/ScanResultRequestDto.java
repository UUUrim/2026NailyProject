package com.example.nailyproject.dto.request;

import com.fasterxml.jackson.annotation.JsonProperty;
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
    private String tone;       // warm/cool/neutral
    private Double brightness; // 0~1
    private Double saturation; // 0~1
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
        // Lombok getter가 getCCurveMm()이 되면서, Jackson이 JSON 필드명을 뽑을 때 쓰는
        // java.beans.Introspector.decapitalize()의 "앞 두 글자가 모두 대문자면 그대로 둔다"는
        // 규칙에 걸려 직렬화 시 "cCurveMm"이 아니라 "CCurveMm"으로 나가버렸다 (역직렬화는
        // 필드 기반이라 문제없이 되지만, ScanService가 이 DTO를 다시 문자열로 직렬화해서
        // DB에 저장할 때 대문자 키로 저장돼 프론트/백엔드 양쪽에서 못 읽는 값이 됨).
        // 명시적으로 고정해서 이 문제를 막는다.
        @JsonProperty("cCurveMm")
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