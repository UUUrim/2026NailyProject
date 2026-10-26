package com.example.nailyproject.dto.response;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.Builder;
import lombok.Getter;

/** 이력에서 다시 연 채팅 — 저장해 둔 채팅 화면 상태 그대로 */
@Getter
@Builder
public class ChatStateResponseDto {
    private Long sessionId;
    private String title;
    private String scanKey;
    private JsonNode state; // 프론트가 저장한 채팅 화면 상태 (말풍선·선택 창·진행 단계 등)
}
