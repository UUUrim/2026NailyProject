package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Data;
import java.util.List;

@Data
@Builder
public class ChatResponseDto {
    private String reply;
    private String nextQuestionTarget;
    private boolean showOptions;
    private List<String> options;
    private boolean isComplete;
}
