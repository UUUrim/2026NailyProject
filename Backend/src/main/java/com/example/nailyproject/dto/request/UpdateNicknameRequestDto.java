package com.example.nailyproject.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class UpdateNicknameRequestDto {
    @NotBlank(message = "닉네임을 입력해주세요.")
    private String nickname;
}
