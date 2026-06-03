package com.example.nailyproject.dto.request;

import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class DesignGenerateRequestDto {

    private Long sessionId; // 채팅 세션 ID (선택지 + 자유입력 포함)

    private Long scanId;    // 손 분석 스캔 ID (필수로 바꿀수도?)
}