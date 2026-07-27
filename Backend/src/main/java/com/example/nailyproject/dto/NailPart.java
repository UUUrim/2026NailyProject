package com.example.nailyproject.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * parts 배열 내부, "파츠 1개" 단위.
 * part_name: 파츠 이름 (자유 텍스트, 사람이 읽기 위한 라벨. 3D 생성 로직은 이 값을 안 보고 primitives만 봄)
 * position: 손톱 표면 위 상대 좌표 [x, y], 0~1로 정규화 (0,0=손톱 왼쪽 아래, 1,1=오른쪽 위)
 * rotationDeg: 파츠 회전 각도 (도 단위)
 * sizeRatioToNailWidth: 손톱 폭 대비 파츠의 상대 크기 (0~1). LLM이 실측 mm를 모르므로
 *                        비율만 정하고, 실제 mm 변환은 스캔 데이터를 이용해 코드에서 계산
 * aspectRatio: 파츠의 가로:세로 비율 (정사각형인지 세로로 긴 물방울형인지 등)
 * attachFlatBase: 이 파츠가 손톱에 물리적으로 부착되는 파츠인지 여부
 *                 (true면 바닥을 평평하게 생성해서 접착 가능하게 함)
 * primitives: 이 파츠를 구성하는 도형 연산들의 배열
 */
@Getter
@Setter
public class NailPart {
    private String partName;
    private List<Double> position;
    private Double rotationDeg;
    private Double sizeRatioToNailWidth;
    private Double aspectRatio;
    private Boolean attachFlatBase;
    private List<Primitive> primitives;
}
