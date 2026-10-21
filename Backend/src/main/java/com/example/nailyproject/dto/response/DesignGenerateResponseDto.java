package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;
import java.util.List;
import java.util.Map;

@Getter
@Builder
public class DesignGenerateResponseDto {
    private Long designId;
    private String status;
    private String generatedPrompt;
    private List<String> imageUrls;
    private Details details;
    private List<String> keywords;  // ★ 추가: 슬롯에서 추출한 키워드

    // 서버가 확정해서 이미지 생성에 쓴 네일 쉐입(round/oval/almond/stiletto/ballerina/square).
    // 프론트가 결과 화면/AR 미리보기에서 사용자 스캔 쉐입이 아니라 이 값을 쓰도록 내려준다.
    private String shape;

    // keywords 중 컬러 키워드의 원래 hex — 결과 화면이 그 키워드를 색 스와치 + 색 이름으로 보여준다.
    // name은 keywords에 들어간 표기 그대로다.
    private List<KeywordColor> keywordColors;

    // 플랜 키워드(마감/패턴/파츠) 없이 슬롯(무드/디자인 타입/모티프/계절/쉐입/컬러)만으로 만든 키워드 — 선택지 기반 결과 화면용.
    // 생성 때는 "기타" 의견에서 GPT가 뽑은 값을 자유 입력과 같은 방식으로 보여 주는 데, 수정 후에는 "고른 값"(수정으로
    // 바뀐 값 반영)만 보여 주는 데 쓴다.
    private List<String> slotKeywords;

    // 채팅 수정 요청(refine)이 실제 수정 요청이 아니거나 이해하지 못해서 이미지를 바꾸지 않았을 때,
    // 사용자에게 보여줄 안내 메시지. 값이 있으면 imageUrls는 기존(바뀌지 않은) 이미지다. 평소에는 null.
    private String assistantMessage;

    // assistantMessage와 함께 내려가는 "이렇게 말씀해 보세요" 선택지(클릭하면 그 문장이 수정 요청으로 전송됨).
    // assistantMessage가 null이면 같이 null.
    private List<String> assistantOptions;

    // assistantMessage와 함께 내려가는 값. 사용자가 수정 대신 "방금 디자인으로 확정할래"처럼 지금 디자인을
    // 그대로 쓰겠다고 했으면 true — 프론트는 선택지 맨 위에 "방금 디자인으로 확정할게요"를 띄운다.
    // assistantMessage가 null이면 같이 null.
    private Boolean confirmSuggested;

    // 스캔 정보 기반 자동 생성(mode=scan-auto)일 때만 채워진다. 그 외에는 null.
    // 결과 화면 "내 손 분석 정보를 반영했어요"에서 추천 팔레트 중 어떤 색이 쓰였는지,
    // 어떤 무드/디자인 타입이 반영됐는지 보여주는 데 사용한다.
    private ScanAutoReflection scanAutoReflection;

    // 사진 기반 생성일 때, 올린 참고 사진의 S3 URL — 채팅 화면의 사진 미리보기(data URL)를 이 주소로 바꿔
    // 채팅을 저장해도 사진이 남게 한다. 그 외에는 null.
    private String referenceImageUrl;

    @Getter
    @Builder
    public static class Details {
        private List<String> colorPalette; // detect 서버가 뽑은 hex 리스트
        private List<String> textures;     // designPlan에서 추출한 텍스처 키
        private Map<String, String> swatches; // ★ 신규: { "glitter": "S3_URL", ... } — 비동기 생성이라 초기엔 null
    }

    @Getter
    @Builder
    public static class KeywordColor {
        private String hex;  // "#RRGGBB"
        private String name; // 한글 색 이름 ("페일 핑크")
    }

    @Getter
    @Builder
    public static class ScanAutoReflection {
        private List<String> recommendedColors; // 스캔 추천 팔레트 전체 (hex, 원본 순서)
        private List<String> usedColors;        // 그 중 이번 디자인에 반영된 색 (hex)
        private String shape;                    // 반영된 네일 쉐입
        // 아래 넷은 결과 화면 표시용 한글 키워드 (여러 개면 ", "로 이음, 없으면 null)
        private String mood;                     // 반영된 무드
        private String designType;               // 반영된 디자인 타입
        private String motif;                    // 반영된 모티프
        private String season;                   // 반영된 계절감 (플랜 top-level season)
    }
}