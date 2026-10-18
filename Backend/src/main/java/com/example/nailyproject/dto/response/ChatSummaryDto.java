package com.example.nailyproject.dto.response;

import lombok.Getter;

import java.time.LocalDateTime;

/**
 * 디자인 채팅 사이드바의 채팅 이력 한 줄.
 * 날짜는 ISO 형식 문자열("2026-10-15T14:30:12")로 내려 준다.
 */
@Getter
public class ChatSummaryDto {
    private final Long sessionId;
    private final String title;     // 채팅 이름 (아직 디자인을 만들기 전이면 null — 프론트가 생성 방식 등으로 대신 보여 준다)
    private final String scanKey;   // 이 채팅에 반영한 손 분석 기록 키 (없으면 null)
    private final String createdAt;
    private final String updatedAt;

    public ChatSummaryDto(Long sessionId, String title, String scanKey, LocalDateTime createdAt, LocalDateTime updatedAt) {
        this.sessionId = sessionId;
        this.title = title;
        this.scanKey = scanKey;
        this.createdAt = createdAt != null ? createdAt.withNano(0).toString() : null;
        this.updatedAt = updatedAt != null ? updatedAt.withNano(0).toString()
                : (createdAt != null ? createdAt.withNano(0).toString() : null);
    }
}
