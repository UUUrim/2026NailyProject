package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Data;
import java.util.List;
import java.util.Map;

@Data
@Builder
public class ChatResponseDto {
    private String reply; //챗봇이 사용자에게 보여줄 한국어 답변
    private String nextQuestionTarget; //담에 물어볼 항목
    private boolean showOptions; //선택지 카드 보여줄지 여부
    private List<String> options; //실제 선택지 목록 (한국어임)
    private Map<String, List<String>> optionColors; // 옵션 라벨 -> 대표 색상 hex 목록 (color 질문일 때만 채워짐)
    private boolean isComplete; //필요정보 다 모였냐?
}
