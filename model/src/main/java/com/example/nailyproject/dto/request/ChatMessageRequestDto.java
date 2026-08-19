package com.example.nailyproject.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class ChatMessageRequestDto {

    @NotBlank(message = "메시지를 입력해주세요.")
    private String message;
}
