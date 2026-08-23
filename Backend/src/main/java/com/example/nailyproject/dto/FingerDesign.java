package com.example.nailyproject.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

//season/shape은 전체 분위기에 넣을 거라 개별 손가락엔 이것말 일단

@Getter
@Setter
public class FingerDesign {
    private String designType;
    private String baseColor;
    private String motif;
    private List<String> parts;
}
