package com.example.nailyproject.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class FingerDesignPlanService {

    private final WebClient.Builder webClientBuilder;
    private final ObjectMapper objectMapper;

    @Value("${gemini.api.key}")
    private String apiKey;

    @Value("${gemini.api.url}")
    private String apiUrl;

    private static final String SYSTEM_PROMPT = """
        당신은 네일 3D 디자인 플래너입니다.
        아래 확정된 정보를 바탕으로 엄지(thumb)~소지(pinky) 5개 손가락의
        디자인을 JSON으로 생성하세요. 참고 이미지가 함께 제공되면
        그 이미지의 스타일/파츠를 최대한 반영하세요.

        [참고 이미지 해석 규칙 - 매우 중요]
        참고 이미지에 등장인물/캐릭터가 있다면, 그 캐릭터가 어떤 작품·프랜차이즈의
        누구인지 특정해 이름을 언급하거나 작풍명을 언급하세요.(예: 오비토, 카카시 등의 캐릭터가 나오면
         "나루토"사용) minimal 단어는 최대한 쓰지 마세요.
        아래처럼 "시각적 스타일 요소"를 최대한 세밀하게 관찰해서 motif/design_type/
        parts에 녹여내세요:
        - 화풍/장르: anime, chibi, cartoon, cel-shaded, manga style 등 (특정 작품명이 있다면 포함하세요.)
        - 색상: 주조색, 보조색, 그라데이션 방향, 톤(파스텔/비비드/딥 등)
        - 선/윤곽: 굵은 아웃라인 여부, 셀셰이딩 여부, 부드러운 선 vs 각진 선 등
        - 질감/마감: 글로시, 매트, 글리터, 펄, 크리스탈 등 표면 느낌 등
        - 형태 모티프: 이미지 속 반복되는 도형/패턴(별, 구름, 줄무늬, 물방울 등)그리고
          캐릭터 고유 심볼이 있다면 무조건 가져오세요.
        - 분위기: 파워풀함, 청량함, 몽환적, 러블리함 등 이미지 전체가 주는 인상
        이렇게 뽑아낸 요소들을 손가락별 parts/design_type에 다양하게 분산시켜서,
        이미지를 안 보고도 "이런 사진, 장르겠구나" 싶을 만큼 구체적인 디자인 플랜을 만드세요.

        [화려한 장식 요소 - 참고 이미지가 있을 때만 적용]
        parts에는 아래 같은 입체 장식 어휘를 적극적으로 활용해서 화려함을 더하세요
        (참고 이미지 분위기에 어울리는 것만 골라서 사용하세요):
         - 3D charm, crystal/rhinestone,foil, glitter, chrome/metallic
                      accent, embossed line art 등
         - 모든 손가락에는 3D charm이나 crystal처럼 입체감 있는 포인트 장식을
                      하나 이상 포함하세요.
        
         parts에는 아래 같은 입체 장식 어휘를 적극적으로 활용해서 화려함을 더하세요
                    (참고 이미지 분위기에 어울리는 것만 골라서 사용하고, 이미지랑 안 어울리면
                    억지로 넣지 마세요):
                    - 3D charm, crystal/rhinestone, foil, glitter, chrome/metallic accent,
                      embossed line art 등
                    - 최소 1~2개 손가락에는 3D charm이나 crystal처럼 입체감 있는 포인트 장식을
                      하나 이상 포함하세요.
            
         [장식 크기·형태 - 참고 이미지가 있을 때만 적용, 매우 중요]
                    "3D pearl", "3D stud"처럼 크기·모양이 뻔하고 작은 점 형태의 기본 장식을
                    기본값처럼 반복해서 넣지 마세요. 특히 서로 다른 손가락에 pearl/stud류를
                    2개 이상 반복해서 쓰는 것은 금지합니다. 대신:
                    - 포인트 장식은 참고 이미지의 실제 모티프 형태를 반영한 "존재감 있는 큰 참"
                      하나로 만드세요. 예를 들어 이미지에 구름이 있으면 "3D fluffy cloud charm"
                      (작은 점이 아니라 손톱 폭의 1/3 정도를 차지하는 입체 구름 모양), 불꽃이
                      있으면 "3D flame-shaped charm", 무기/도구 모티프가 있으면 그 실루엣을 딴
                      "3D [모티프 형태] charm" 식으로, 손가락마다 다른 모티프 형태의 참을
                      하나씩 지정하세요.
                    - 장식 문구에는 크기감을 드러내는 표현을 넣으세요 (예: "large 3D cloud-shaped
                      charm", "oversized 3D flame charm") — "small", "tiny", "dot" 같은
                      표현은 쓰지 마세요.
                    - crystal/rhinestone처럼 원래 작은 게 자연스러운 장식은 예외지만, 그 경우도
                      한 손가락에 하나씩 딱 박아넣기보다 모티프 라인을 따라 배치되는 느낌으로
                      묘사하세요 (예: "line of small crystals following the cloud outline").
                      
        [참고이미지 제공 시 밋밋함 방지 - 참고 이미지가 있을 때만 적용, 매우 중요]
        참고 이미지가 있을 때, 이미지에서 색/패턴 1~2가지만 뽑아서
        그걸 손가락 5개에 기계적으로 번갈아 반복하는 것 금지. minimalist 포함 금지(예: "글로시 블랙" /
        "라인아트 레드"만 왔다갔다). 이런 결과는 절대 만들지 마세요. 대신:
        - 참고 이미지 안에서 최소 3~4가지 이상의 서로 다른 시각 요소(예: 베이스 컬러 A,
          베이스 컬러 B, 라인/패턴 디테일, 그라데이션, 광택 차이, 포인트 장식 등)를
          찾아내고, 5개 손가락에 이 요소들을 골고루 다른 조합으로 배치하세요.
          같은 design_type 문구를 2개 손가락 이상에 똑같이 반복하지 마세요 —
          같은 컬러 계열이어도 표현(마감, 패턴 밀도, 그라데이션 방향 등)을 다르게 쓰세요.
        - parts 배열은 5개 손가락 중 최소 3개 이상에서 비어있지 않아야 하고,
         그 중 최소 2개 손가락은 parts에 태그가 2개 이상이어야 합니다.
        - 참고 이미지에서 최소 4가지 서로 다른 시각 요소(베이스 컬러 A/B, 그라데이션,
          라인/패턴 디테일, 광택 차이, 포인트 장식 등)를 각각 찾아내고, 이 4가지가
          5개 손가락에 나눠서 최소 한 번씩은 등장해야 합니다.
          모든 손가락의 parts를 빈 배열이나 1개짜리로만 채우지 마세요.
        - design_type 문구 자체도 "matte"처럼 단어 하나로 끝내지 말고, 이미지에서
          관찰한 디테일을 붙여서 구체적으로 쓰세요
          (예: "glossy gradient from deep navy to sky blue", "matte base with
          fine metallic line pattern").
        - 색상도 대표색 1개로 뭉개지 말고, 그라데이션이면 두 색을 다 명시하고,
          톤 차이(딥/라이트, 매트/글로시)가 있으면 손가락별로 그 차이를 반영하세요.

        [중요] JSON 안의 모든 문자열 값은 반드시 영어로 작성하세요.
        한국어를 절대 사용하지 마세요.

        [색상 규칙 - 매우 중요]
        color는 이미 최상위(shape, mood, season과 같은 레벨)에서 전체 세트 색상으로
        관리됩니다. 손가락별 지정(손가락별 지정 정보 참고)에서 특정 손가락에 다른
        색을 요청한 경우, 또는 참고 이미지에 서로 다른 색이 함께 나타나는 경우에만
        그 손가락의 base_color를 채우세요. 그 외(지정도 없고 참고 이미지도 없는 경우)
        손가락은 base_color를 빈 문자열("")로 두세요.

        [손가락별 지정 - 매우 중요]
            확정된 입력 정보에 "손가락별 지정"이 포함되어 있다면, 그 지정을 절대적으로
            우선하여 정확히 그대로 반영하세요.
            
            케이스 1) 일부 손가락만 지정되고, 나머지에 대한 별도 공통 지시도 있는 경우
              (예: "엄지·4번째는 3D로, 나머지는 아트로")
              - 지정된 손가락(예: thumb, ring)에는 그 스타일(3D)을 design_type/parts에 반영
              - 나머지 손가락(예: index, middle, pinky)에는 별도로 언급된 공통 스타일(art)을
                design_type에 반영 (빈 값으로 두지 마세요)
              - 이 경우 top-level designType 필드에는 "나머지 손가락들의 공통 스타일"
                하나만 넣으세요 (예: "art"). 지정된 손가락의 스타일(3D)을 top-level에
                같이 나열하지 마세요.
            
            케이스 2) 일부 손가락만 지정되고, 나머지에 대한 언급이 전혀 없는 경우
              - 지정된 손가락에만 design_type/parts/base_color를 채우고,
                언급되지 않은 손가락은 design_type과 base_color를 빈 문자열("")로,
                parts는 빈 배열([])로 두세요.
            
            케이스 3) 손가락별 지정이 전혀 없는 경우
              - 참고 이미지가 없다면: color, designType, motif는 최상위(shape, mood,
                season과 같은 레벨)에서 전체 세트 값으로만 관리하고, 각 손가락의
                design_type/base_color/motif는 전부 빈 값으로 두세요.
              - 참고 이미지가 있다면: 위 [밋밋함 방지] 규칙을 그대로 적용해서, 손가락별
                지정이 없어도 이미지에서 관찰한 디테일을 손가락별 design_type/parts에
                채우세요. "지정이 없으니 비워둔다"는 이 경우엔 적용하지 않습니다 —
                참고 이미지 자체가 손가락별 디테일의 근거입니다.
            
            케이스 4) 손가락을 특정하지 않고 "두 스타일을 섞어달라/적절히 배치해달라"는
            경우 (예: "3D 파츠와 아트 둘 다 적절히 올려줘")
              - 이건 사용자가 손가락을 지정한 게 아니라, 당신에게 배치를 맡긴 것입니다.
              - 두 스타일 중 더 기본이 되는 쪽 하나를 골라 top-level designType에 넣으세요
                (예: "art"를 기본으로).
              - 나머지 스타일(예: 3D)은, 아래 [규칙]의 "포인트가 되는 손가락 1~2개 변주"
                원칙에 따라 당신이 자유롭게 1~2개 손가락을 골라 그 손가락의 개별
                design_type에만 반영하세요.
              - top-level에는 여전히 하나의 값만 남기고, 혼합감은 손가락별 필드로
                표현하세요.
                
            [손가락별 비선호 - 매우 중요]
            확정된 입력 정보에 "손가락별 비선호"가 표시되어 있다면, 그 손가락의
            design_type, motif, parts를 정할 때 명시된 요소를 절대 사용하지 마세요.
            전체 공통 negative와는 별개로, 이 지정은 해당 손가락에만 더 엄격하게
            추가로 적용되는 제약입니다.
            
        [공통 규칙] 어떤 경우든 top-level의 designType/motif 필드에는 서로 다른
            스타일을 콤마로 나열하지 마세요. 반드시 하나의 값(또는 "가장 대표적인 하나")만 넣으세요.

        [parts 작성 규칙]
        parts는 좌표나 크기 없이, 자유 텍스트로 된 짧은 태그들의 배열입니다.
        - 입체적으로 도드라지는 장식(리본, 보석, 진주, 스터드 등)은 "3D"를 포함해서 작성:
          예: "3D ribbon", "3D pearl stud", "3D rhinestone"
        - 평면적인 그림(아트)/스티커/패턴은 "art" 또는 "sticker"를 포함해서 작성:
          예: "floral art", "cat sticker", "line art"
        - 파츠가 필요 없으면 빈 배열 []로 두세요.
            [중요] 확정된 입력 정보에 "(피해야 함)"으로 표시된 값이 있다면, 그 값과 관련된
            어떤 표현도 parts에 사용하면 안 됩니다. 특히 designType이나 motif에 "3D"가
            피해야 할 값으로 표시되어 있다면, parts 태그에도 "3D"가 들어간 표현
            (예: "3D ribbon", "3D pearl stud")을 절대 쓰지 말고, 대신 "art" 또는 "sticker"
            스타일로 대체하세요. 이 제약은 손가락별 지정이 있든 없든 모든 손가락에 동일하게 적용됩니다.

        [규칙]
        - motif가 필요 없는 손가락은 motif를 "none"으로 두세요.
        - design_type은 자유 텍스트입니다 (예: "glitter", "french tip", "matte", "gradient").

        [color 미지정 시 처리]
        확정된 입력 정보에 "color 후보"가 주어졌다면, 그 후보들 중 mood/season과
        가장 잘 어울리는 색상 하나(또는 조합)를 당신이 판단해서 최상위 color에 채우세요.
        color 후보도 없다면, mood/season에 어울리는 색을 자유롭게 만들어서 사용하세요.
        %s

        [확정된 입력 정보]
        %s

        반드시 아래 JSON 형식으로만 응답하세요. 마크다운 없이 순수 JSON만 반환합니다.
        {
          "shape": "...", "mood": "...", "season": "...", "color": "...","designType": "...", "motif": "...",
          "thumb": { "design_type": "", "base_color": "", "motif": "none", "parts": [] },
          "index": { "design_type": "", "base_color": "", "motif": "none", "parts": [] },
          "middle": { "design_type": "", "base_color": "", "motif": "none", "parts": [] },
          "ring": { "design_type": "", "base_color": "", "motif": "none", "parts": [] },
          "pinky": { "design_type": "", "base_color": "", "motif": "none", "parts": [] }
        }
        """;

    /**
     * 참고 이미지 없이 플랜 생성
     */
    public JsonNode generatePlan(String confirmedInputSummary) {
        return generatePlan(confirmedInputSummary, null, null, null);
    }

    /**
     * 참고 이미지(base64)와 함께 플랜 생성 (새 디자인, 이전 플랜 없음)
     * @param imageBase64  base64로 인코딩된 이미지 (없으면 null)
     * @param imageMimeType 예: "image/jpeg", "image/png"
     */
    public JsonNode generatePlan(String confirmedInputSummary, String imageBase64, String imageMimeType) {
        return generatePlan(confirmedInputSummary, imageBase64, imageMimeType, null);
    }

    /**
     * "수정하고 싶어요" 흐름 전용: 직전에 만들어졌던 플랜(previousPlanJson)을 같이 넘겨서,
     * 사용자가 요청한 부분만 바꾸고 나머지 손가락/필드는 이전 문구를 그대로 유지하도록 한다.
     * 이걸 안 넘기면(=previousPlanJson이 null) 매번 완전히 새로 창작하듯 플랜을 만들어서,
     * "새끼손가락에 파츠 하나만 추가해줘" 같은 사소한 수정에도 5개 손가락이 전부 바뀌어버렸다.
     */
    public JsonNode generatePlan(String confirmedInputSummary, String imageBase64, String imageMimeType, String previousPlanJson) {

        String editModeSection = "";
        if (previousPlanJson != null && !previousPlanJson.isBlank()) {
            editModeSection = """
                    [이전 디자인 플랜 - 매우 중요, 반드시 지킬 것]
                    이번 요청은 완전히 새로운 디자인을 만드는 게 아니라, 아래 "이전 플랜"을
                    기준으로 사용자가 [확정된 입력 정보]에서 요청한 부분만 "수정"하는 것입니다.
                    - 사용자가 명시적으로 언급하지 않은 손가락/필드는 이전 플랜의 값을
                      단어 하나도 바꾸지 말고 그대로 복사해서 쓰세요 (design_type, base_color,
                      motif, parts 전부 동일하게).
                    - 사용자가 특정 손가락을 지목했다면(예: "새끼손가락에 파츠 하나 추가"),
                      그 손가락의 parts/design_type만 요청에 맞게 바꾸고, 다른 4개 손가락은
                      이전 플랜 그대로 유지하세요.
                    - [매우 중요 - 우선순위] [확정된 입력 정보]의 "손가락별 지정"이나
                      "손가락별 비선호"에 특정 손가락이 언급돼 있다면, 그 손가락에 대해서는
                      "이전 플랜 그대로 유지" 규칙을 무시하고 반드시 그 지정/비선호에 맞게
                      해당 손가락의 design_type/parts를 실제로 다시 쓰세요. 예를 들어 이전
                      플랜의 ring이 "star shaped charm"을 갖고 있었는데 손가락별 비선호에
                      ring: star가 있다면, ring의 parts에서 star 관련 표현을 완전히 제거하고
                      다른 요소(예: 언급된 대체 모티프)로 바꿔서 새로 써야 합니다. "이전 플랜에
                      있던 문구니까 그대로 둔다"는 절대 안 됩니다 — 그러면 최종 프롬프트에
                      "no star"와 "star shaped charm"이 동시에 나오는 모순이 생깁니다.
                    - top-level의 shape/mood/season/color/designType/motif도, 사용자가
                      바꿔달라고 한 것만 바꾸고 나머지는 이전 값 그대로 유지하세요.
                    - color를 hex로 다시 확정 짓지 마세요. 이전 플랜의 색 표현을 그대로 쓰세요.

                    [이전 플랜 (JSON)]
                    %s
                    """.formatted(previousPlanJson);
        }

        String systemPrompt = String.format(SYSTEM_PROMPT, editModeSection, confirmedInputSummary);

        List<Map<String, Object>> parts = new ArrayList<>();
        if (imageBase64 != null && imageMimeType != null) {
            parts.add(Map.of(
                    "inline_data", Map.of(
                            "mime_type", imageMimeType,
                            "data", imageBase64
                    )
            ));
            parts.add(Map.of("text", "이 참고 이미지를 자세히 관찰해서, 캐릭터/작품을 특정하지 말고 " +
                    "색감·선/셰이딩 스타일·질감·반복되는 형태 모티프·전체 분위기를 최대한 " +
                    "구체적으로 뽑아낸 뒤, 위 정보와 함께 5개 손가락 디자인을 생성해주세요."));
        } else {
            parts.add(Map.of("text", "위 정보로 5개 손가락 디자인을 생성해주세요."));
        }

        Map<String, Object> requestBody = Map.of(
                "contents", List.of(Map.of("role", "user", "parts", parts)),
                "systemInstruction", Map.of("parts", List.of(Map.of("text", systemPrompt))),
                //5개 손가락+파츠까지 담아야 해서 응답이 길어질 수 있으므로 토큰을 넉넉히, thinking은 낮게
                "generationConfig", Map.of(
                        "responseMimeType", "application/json",
                        "maxOutputTokens", 8192,
                        "thinkingConfig", Map.of("thinkingLevel", "LOW")
                )
        );

        JsonNode responseNode = callGeminiWithRetry(requestBody);

        String text = responseNode.path("candidates").get(0)
                .path("content").path("parts").get(0).path("text").asText();

        try {
            return objectMapper.readTree(text);
        } catch (Exception e) {
            System.err.println("디자인 플랜 JSON 파싱 실패. 원본 응답: " + text);
            throw new IllegalStateException("디자인 플랜 생성 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.");
        }
    }

    /**
     * Gemini 호출. 429(요청 한도 초과)면 잠깐 대기 후 최대 2회 재시도.
     */
    private JsonNode callGeminiWithRetry(Map<String, Object> requestBody) {
        WebClient webClient = webClientBuilder.build();
        int maxAttempts = 3;
        long backoffMillis = 1500;

        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return webClient.post()
                        .uri(apiUrl + "?key=" + apiKey.trim())
                        .bodyValue(requestBody)
                        .retrieve()
                        .bodyToMono(JsonNode.class)
                        .block();
            } catch (org.springframework.web.reactive.function.client.WebClientResponseException e) {
                int statusCode = e.getStatusCode().value();
                boolean isRetryable = statusCode == 429 || statusCode == 503; // 429=요청과다, 503=모델 과부하
                boolean hasAttemptsLeft = attempt < maxAttempts;

                System.err.println("Gemini API 호출 실패 (시도 " + attempt + "/" + maxAttempts + "): "
                        + e.getStatusCode() + " " + e.getResponseBodyAsString());

                if (isRetryable && hasAttemptsLeft) {
                    try {
                        Thread.sleep(backoffMillis * attempt);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                    }
                    continue;
                }

                if (isRetryable) {
                    throw new IllegalStateException("지금 AI 서버가 혼잡해서 디자인 플랜 생성이 지연되고 있어요. 잠시 후 다시 시도해 주세요.");
                }
                throw new IllegalStateException("디자인 플랜용 AI 응답을 받아오지 못했어요. 잠시 후 다시 시도해 주세요.");
            }
        }
        throw new IllegalStateException("디자인 플랜용 AI 응답을 받아오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
}