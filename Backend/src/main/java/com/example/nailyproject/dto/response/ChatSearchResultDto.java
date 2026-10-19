package com.example.nailyproject.dto.response;

import lombok.Getter;

import java.time.LocalDateTime;

/**
 * 디자인 채팅 사이드바 검색 결과 한 줄 — 채팅 이름이나 대화 내용에 검색어가 들어간 채팅.
 * snippet은 검색어가 들어간 말풍선 글 일부 (이름에만 들어갔으면 null).
 */
@Getter
public class ChatSearchResultDto {
    private final Long sessionId;
    private final String title;
    private final String scanKey;
    private final String createdAt;
    private final String updatedAt;
    private final boolean titleMatched;
    private final String snippet;

    public ChatSearchResultDto(Long sessionId, String title, String scanKey, LocalDateTime createdAt,
                               LocalDateTime updatedAt, boolean titleMatched, String snippet) {
        this.sessionId = sessionId;
        this.title = title;
        this.scanKey = scanKey;
        this.createdAt = createdAt != null ? createdAt.withNano(0).toString() : null;
        this.updatedAt = updatedAt != null ? updatedAt.withNano(0).toString() : this.createdAt;
        this.titleMatched = titleMatched;
        this.snippet = snippet;
    }
}
