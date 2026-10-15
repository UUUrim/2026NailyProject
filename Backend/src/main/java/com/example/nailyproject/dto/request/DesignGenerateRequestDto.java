package com.example.nailyproject.dto.request;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
public class DesignGenerateRequestDto {

    private Long sessionId; // 채팅 세션 ID (선택지 + 자유입력 포함)

    private Long scanId;    // 손 분석 스캔 ID (필수로 바꿀수도?)

    // 생성 방식 구분. 현재는 "scan-auto"(스캔 정보 기반 자동 생성)만 특별 처리하고,
    // null이거나 그 외 값이면 기존 상세 생성 흐름을 그대로 탄다.
    private String mode;

    // 사진 기반 생성에서 사용자가 입력창에 적은 추가 요청(예: "수채화 느낌을 잘 살려줘"). 없으면 null.
    private String userNote;
}