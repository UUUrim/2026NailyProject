package com.example.nailyproject.dto.request;

import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 스캔 서버가 손 하나의 측정이 끝났을 때 보내는 상태 콜백.
 * 분석 값(피부톤, 추천 컬러, 치수 등)은 여기에 없다 - 양손 최종 measurements.json에만 있고
 * ScanResultFileService가 로컬 파일을 직접 읽는다.
 */
@Getter
@NoArgsConstructor
public class ScanResultRequestDto {

    private Boolean success;        // 측정에 성공한 손가락이 하나라도 있으면 true
    private String message;         // 실패 사유
    private Integer measuredFingers; // 측정에 성공한 손가락 수 (0~5)

    public boolean isFailed() {
        return !Boolean.TRUE.equals(success) || measuredFingers == null || measuredFingers <= 0;
    }
}
