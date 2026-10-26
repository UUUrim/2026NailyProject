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
    private Integer queueSize;
    private String gcodeState;       // IDLE / PREPARE / RUNNING / PAUSE / FINISH / FAILED / UNKNOWN - PAUSE면 일시정지 중
    private Long currentOrderId;     // 지금 출력(또는 출력 준비) 중인 주문 ID, 없으면 null
}