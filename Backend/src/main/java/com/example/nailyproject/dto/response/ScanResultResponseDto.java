package com.example.nailyproject.dto.response;

import com.example.nailyproject.entity.HandScan;
import com.example.nailyproject.entity.ScanImg;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

//사용자의 화면에 분석 결과를 띄워주기 위한 목적

@Getter
@Builder
public class ScanResultResponseDto {

    private Long scanId;
    private String handSide;
    private String status;

    // 분석 결과
    private String shape;
    private String recommendedShape;
    private String skinToneHex;
    private List<String> recommendedColors;
    private String tone;
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
        private String imageUrl;
        private String imageUrlSide;
        private String stlUrl;
        private String measurements; // JSON 문자열
        private String size;
    }

    public static ScanResultResponseDto from(
            HandScan handScan,
            List<ScanImg> scanImages,
            ObjectMapper objectMapper
    ) {
        List<FingerResultDto> fingers = scanImages.stream()
                .map(img -> FingerResultDto.builder()
                        .finger(img.getFinger().name())
                        .imageUrl(img.getImageUrl())
                        .imageUrlSide(img.getImageUrlSide())
                        .stlUrl(img.getStlUrl())
                        .measurements(img.getMeasurements())
                        .size(img.getSize())
                        .build())
                .collect(Collectors.toList());

        return ScanResultResponseDto.builder()
                .scanId(handScan.getId())
                .handSide(handScan.getHandSide().name())
                .status(handScan.getStatus().name())
                .shape(handScan.getShape())
                .recommendedShape(handScan.getRecommendedShape())
                .skinToneHex(handScan.getSkinToneHex())
                .recommendedColors(parseRecommendedColors(handScan.getRecommendedColors(), objectMapper))
                .tone(handScan.getTone())
                .brightness(handScan.getBrightness())
                .saturation(handScan.getSaturation())
                .overallSize(handScan.getOverallSize())
                .scannedAt(handScan.getScannedAt())
                .fingers(fingers)
                .build();
    }

    // ScanHistoryItemDto(마이페이지 목록 조회)도 동일한 JSON 문자열 필드를 파싱해야 해서 공개해 둔다.
    public static List<String> parseRecommendedColors(String raw, ObjectMapper objectMapper) {
        if (raw == null || raw.isBlank()) {
            return Collections.emptyList();
        }
        try {
            return objectMapper.readValue(raw, new TypeReference<List<String>>() {});
        } catch (Exception ignored) {
            // List.toString() 형태 "[#AABBCC, #DDEEFF]" 호환
            String trimmed = raw.trim();
            if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
                trimmed = trimmed.substring(1, trimmed.length() - 1).trim();
                if (trimmed.isEmpty()) {
                    return Collections.emptyList();
                }
                return List.of(trimmed.split("\\s*,\\s*"));
            }
            return Collections.emptyList();
        }
    }
}