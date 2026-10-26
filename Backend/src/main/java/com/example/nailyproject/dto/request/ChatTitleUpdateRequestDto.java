package com.example.nailyproject.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 채팅 이름 직접 바꾸기 */
@Getter
@NoArgsConstructor
public class ChatTitleUpdateRequestDto {
    @NotBlank
    @Size(max = 100)
    private String title;
}
