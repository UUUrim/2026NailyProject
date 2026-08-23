package com.example.nailyproject.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class RefineRequestDto {

    @NotBlank(message = "원하는 세부 디자인을 입력해주세요.")
    private String message;
}