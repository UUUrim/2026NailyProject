package com.example.nailyproject.dto.request;

import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 디자인 확정 PATCH /designs/{designId}/confirm 요청 본문 (없어도 된다).
 * chatTranscript: 확정하는 순간 채팅 화면에 보이던 대화 그대로 — 이 디자인의 채팅 이력으로 저장한다.
 */
@Getter
@NoArgsConstructor
public class DesignConfirmRequestDto {
    private List<ChatTranscriptEntryDto> chatTranscript;
}
