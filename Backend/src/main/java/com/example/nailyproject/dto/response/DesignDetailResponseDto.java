package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;

import java.util.List;

/** 디자인 상세 (이미지 모달 / 둘러보기 상세용) */
@Getter
@Builder
public class DesignDetailResponseDto {
    private Long designId;
    private String imageUrl;
    private String createdAt;
    private boolean shared;
    private boolean owner;
    private DesignGenerateResponseDto.Details details;
    private List<String> imageUrls;
    // 네일팁 쉐입(round/oval/almond/square/stiletto/ballerina) — AR 미리보기가 맞는
    // 3D 템플릿 메시를 고르는 데 씀. designPlan JSON에서 추출, 없으면 null.
    private String shape;
    // detect 서버가 생성 시점에 뽑아낸 손가락별(엄지~새끼, 왼쪽부터) 매트 이미지 URL 5개 —
    // AR 미리보기가 로컬 세그멘테이션 대신 이걸 우선 사용. 없으면(옛날 디자인/추출 실패) null.
    private List<String> nailTipCropUrls;
}
