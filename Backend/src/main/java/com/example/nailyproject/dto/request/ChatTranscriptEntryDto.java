package com.example.nailyproject.dto.request;

import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 디자인 채팅 화면에 보이던 말풍선 하나 (디자인 확정 시 프론트가 화면 그대로 보내 저장하고,
 * "디자인 다시 생성하기"와 마이페이지 채팅 이력에서 똑같이 다시 그린다).
 * 화면 표시용이라 GPT 대화 기록(chat_message)이나 디자인 생성에는 쓰지 않는다.
 */
@Getter
@NoArgsConstructor
public class ChatTranscriptEntryDto {
    private String role;                // "user" | "assistant"
    private String content;             // 말풍선 글 (아이콘 자리표시자 {{qicon}} 등 포함, 없으면 "")
    private List<String> imageUrls;     // 디자인 결과 이미지 또는 참고 사진 (참고 사진은 자리표시자로 와서 저장 시 S3 URL로 바뀐다)
    private List<String> colorSwatches; // 말풍선 안 색 동그라미 (hex)
    private Boolean colorsInline;       // true면 색 동그라미를 글 바로 옆에 붙인다
    private String textAfterColors;     // 색 동그라미 아래 줄의 글 (컬러 "기타(…)")
    private Boolean designResult;       // 디자인 결과 카드
    private Boolean historyOnly;        // 채팅 화면엔 안 보이고 채팅 이력에만 보이는 말풍선 (선택지 기반에서 서버로 보낸 요약 문장)
    private Boolean chatOnly;           // 채팅 화면에만 보이고 마이페이지 채팅 이력에서는 빼는 말풍선 (선택지 기반의 단계별 선택)
    private String historySection;      // "method": 첫 인사·생성 방식 고르기에 속한 말풍선 (마이페이지 이력은 그 다음부터 보여 준다)
    private String generationMethod;    // 이 말풍선에서 시작된 생성 방식 (preference / freeform / photo / scan-auto)

    public ChatTranscriptEntryDto(String role, String content, List<String> imageUrls, List<String> colorSwatches,
                                  Boolean colorsInline, String textAfterColors, Boolean designResult, Boolean historyOnly,
                                  Boolean chatOnly, String historySection, String generationMethod) {
        this.role = role;
        this.content = content;
        this.imageUrls = imageUrls;
        this.colorSwatches = colorSwatches;
        this.colorsInline = colorsInline;
        this.textAfterColors = textAfterColors;
        this.designResult = designResult;
        this.historyOnly = historyOnly;
        this.chatOnly = chatOnly;
        this.historySection = historySection;
        this.generationMethod = generationMethod;
    }
}
