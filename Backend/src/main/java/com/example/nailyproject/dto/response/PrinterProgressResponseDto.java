package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class PrinterProgressResponseDto {
    private boolean success;
    private String state;            // 예: PRINTING, CALIBRATING_EXTRUSION, IDLE, UNKNOWN
    private Integer percentage;      // 0~100, 아직 시작 전이면 null
    private Integer remainingTimeMin;
    private Double nozzleTemp;
    private Double bedTemp;
    private String message;          // 실패 시 원인 메시지
}