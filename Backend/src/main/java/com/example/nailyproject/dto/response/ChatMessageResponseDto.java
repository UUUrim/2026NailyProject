package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;

import java.util.List;

@Getter
@Builder
public class ChatMessageResponseDto {
    private String role;    // "user" | "assistant"
    private String content;
    private String sentAt;
    private List<String> imageUrls; // 중간에 생성됐던 디자인 이미지 (텍스트 메시지면 null)
    private Long designId;          // imageUrls가 있을 때, 그 디자인의 id (확정된 디자인인지 구분용)

    // 아래는 확정 시 저장한 채팅 화면 대화(ChatTranscriptEntryDto)로 이력을 돌려줄 때만 채워진다 — 예전 이력은 null
    private List<String> colorSwatches; // 말풍선 안 색 동그라미 (hex)
    private Boolean colorsInline;       // true면 색 동그라미를 글 바로 옆에 붙인다
    private String textAfterColors;     // 색 동그라미 아래 줄의 글
    private Boolean designResult;       // 디자인 결과 카드
    private Boolean historyOnly;        // 채팅 화면엔 안 보이고 채팅 이력에만 보이는 말풍선
    private Boolean chatOnly;           // 채팅 화면에만 보이고 마이페이지 채팅 이력에서는 빼는 말풍선
    private String historySection;      // "method": 첫 인사·생성 방식 고르기에 속한 말풍선
    private String generationMethod;    // 이 말풍선에서 시작된 생성 방식 (preference / freeform / photo / scan-auto)
}