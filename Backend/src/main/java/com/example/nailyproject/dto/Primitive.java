package com.example.nailyproject.dto;

import lombok.Getter;
import lombok.Setter;

/**
 * 파츠 내부의 "도형 연산" 1개 단위.
 * op: extrude_outline / sphere_dome / cone / cylinder 중 하나로 제한
 * outline_type: op이 extrude_outline일 때만 사용 (loop_left / loop_right 등)
 * width_ratio, height_ratio: 파츠 전체 크기 대비 이 도형 요소의 상대 폭/높이 비율
 * thickness_mm, height_mm, diameter_mm, radius_ratio: 실측 치수 또는 상대값 (mm 단위는 실측값, ratio는 상대값)
 * color: hex, 파츠 안에서도 부분별로 색이 다를 수 있어 primitive 레벨에 존재
 * material: pearl / metal / matte / glossy 등
 * role: 선택적, 이 도형 요소가 파츠 안에서 하는 역할 힌트 (예: center_knot)
 */
@Getter
@Setter
public class Primitive {
    private String op;
    private String outlineType;
    private Double widthRatio;
    private Double heightRatio;
    private Double thicknessMm;
    private Double heightMm;
    private Double diameterMm;
    private Double radiusRatio;
    private String color;
    private String material;
    private String role;
}
