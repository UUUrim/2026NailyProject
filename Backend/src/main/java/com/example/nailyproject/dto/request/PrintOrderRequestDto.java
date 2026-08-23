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
}