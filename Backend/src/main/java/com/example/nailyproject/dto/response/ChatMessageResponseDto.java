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
}