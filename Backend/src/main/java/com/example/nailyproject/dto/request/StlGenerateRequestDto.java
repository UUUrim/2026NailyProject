package com.example.nailyproject.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class StlGenerateRequestDto {
    @NotBlank(message = "쉐입(shape)을 선택해주세요.")
    private String shape; // 유저가 최종 선택한 쉐입 (예: square, almond)
}