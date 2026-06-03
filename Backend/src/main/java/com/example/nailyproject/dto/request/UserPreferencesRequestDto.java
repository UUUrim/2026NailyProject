package com.example.nailyproject.dto.request;

import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.List;

@Getter
@NoArgsConstructor
public class UserPreferencesRequestDto {

    private List<String> mood;          // 최대 2개 (lovely, simple, modern ...)
    private List<String> designType;    // 최대 2개 (glitter, gradient, cheek ...)
    private String season;              // 1개 (spring, summer, autumn, winter, 상관없음)
    private String length;              // 1개 (short, medium, long)
    private List<String> motif;         // 최대 2개 (star, ribbon, floral ...)
    private String shape;               // 1개 (아몬드, 라운드, 스퀘어, 스틸레토, 발리나, 오발)
    private List<String> color;         // 최대 2개
}
