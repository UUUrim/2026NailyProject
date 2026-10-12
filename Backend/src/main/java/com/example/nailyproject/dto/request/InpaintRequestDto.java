package com.example.nailyproject.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
@NoArgsConstructor
public class InpaintRequestDto {

    /** 수정할 NailDesign ID */
    private Long designId;

    /** 바꿀 손톱에 대한 설명 (예: "glossy gel, mint green base color") */
    @NotBlank
    private String prompt;

    /**
     * 왼쪽부터 1·2·3·4·5. 여러 손톱 동시 수정 가능.
     * 예: [4] → 약지만, [1, 5] → 엄지·새끼 동시
     */
    @NotEmpty
    private List<Integer> nailIndex;

    /** 0~1. 낮을수록 원본 유지. 기본값 0.65 */
    private Float strength = 0.65f;

    /** 재현용 seed (선택) */
    private Integer seed;
}