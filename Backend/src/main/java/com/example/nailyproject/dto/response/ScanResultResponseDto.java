package com.example.nailyproject.dto.response;

import com.example.nailyproject.entity.HandScan;
import com.example.nailyproject.entity.ScanImg;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

@Getter
@Builder
public class ScanResultResponseDto {

    private Long scanId;
    private String handSide;
    private String status;

    // 분석 결과
    private String shape;
    private String skinToneHex;
    private List<String> recommendedColors;

    // 손가락별 결과
    private List<FingerResultDto> fingers;

    private LocalDateTime scannedAt;

    @Getter
    @Builder
    public static class FingerResultDto {
        private String finger;
        private String imageUrl;
        private String annotatedImageUrl;
        private String stlUrl;
        private String measurements; // JSON 문자열
        private String size;
    }

    public static ScanResultResponseDto from(HandScan handScan, List<ScanImg> scanImages) {
        List<FingerResultDto> fingers = scanImages.stream()
                .map(img -> FingerResultDto.builder()
                        .finger(img.getFinger().name())
                        .imageUrl(img.getImageUrl())
                        .annotatedImageUrl(img.getAnnotatedImageUrl())
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
                .skinToneHex(handScan.getSkinToneHex())
                .scannedAt(handScan.getScannedAt())
                .fingers(fingers)
                .build();
    }
}