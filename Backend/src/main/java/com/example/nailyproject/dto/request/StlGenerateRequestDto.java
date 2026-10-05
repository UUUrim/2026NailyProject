package com.example.nailyproject.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class StlGenerateRequestDto {
    @NotBlank(message = "쉐입(shape)을 선택해주세요.")
    private String shape; // 유저가 최종 선택한 쉐입 (예: square, almond)

    // 유저가 출력 페이지에서 +/- 로 조절한 팁 연장 길이(mm). 생략(null)하면 파이썬 서버가
    // 쉐입별 기본값(scan/nail_exact_stl.py의 TIP_EXTENSION_DEFAULT_MM)을 그대로 사용한다.
    private Double tipExtensionMm;
}