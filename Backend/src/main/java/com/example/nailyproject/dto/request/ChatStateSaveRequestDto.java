package com.example.nailyproject.dto.request;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 디자인 채팅 화면 상태 저장 — 사이드바의 채팅 이력에서 다시 열면 그대로 이어서 한다.
 * 화면 표시용이라 GPT 대화 기록(chat_message)이나 디자인 생성에는 쓰지 않는다.
 */
@Getter
@NoArgsConstructor
public class ChatStateSaveRequestDto {
    private JsonNode state;     // 채팅 화면 상태 (참고 사진 미리보기는 자리표시자 "reference-photo"로 온다)
    private String scanKey;     // 이 채팅에 반영 중인 손 분석 기록 키 (없으면 null)
    private String autoTitle;   // 그 채팅에서 만든 네일 분위기로 지은 이름 (아직 없으면 null — 사용자가 바꾼 이름은 덮어쓰지 않는다)
}
