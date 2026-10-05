package com.example.nailyproject.dto.request;

import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class PrintOrderRequestDto {
    private String shapeId;
    private String shapeLabelKo;
    private Long leftScanId;  // 선택 (없을 수 있음)
    private Long rightScanId; // 선택 (없을 수 있음)
    private Double tipExtensionMm; // 출력 화면에서 설정한 팁 연장 길이(mm) — 출력 내역 표시용
}