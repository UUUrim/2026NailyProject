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

/**
 * Gemini API를 사용해 디자인 프롬프트에서 사용된 텍스처 종류와 컬러를 추출한다.
 * test_texture_batch.py의 "안3" 방식 — 텍스처 프롬프트 작성까지 Gemini에 맡기지 않고,
 * "어떤 텍스처+어떤 컬러(이름과 hex)"만 추출한 뒤 TextureSwatchService가 SwatchColorizer로 스와치를 만든다.
 *
 * Gemini 호출 패턴은 FingerDesignPlanService.callGeminiWithRetry()와 동일하게 구성함.
 */
@Service
@RequiredArgsConstructor
public class TextureExtractService {

    private final WebClient.Builder webClientBuilder;
    private final ObjectMapper objectMapper;
    private final GptClientService gptClientService;

    // Gemini 설정 - GPT로 교체하면서 주석 처리 (롤백 대비, 삭제 안 함)
    // @Value("${gemini.api.key}")
    // private String apiKey;
    //
    // @Value("${gemini.api.url}")
    // private String apiUrl;

    // 스와치 대상은 "재료"만이다. 그라데이션/프렌치/치크/마블/드로잉 같은 시술 기법은 텍스처가 아니다.
    private static final String SYSTEM_PROMPT = """
            You are a nail art analyst. Given a nail design prompt, extract ONLY the gel/polish
            materials (textures) and colors actually used in the design.

            Supported textures (use EXACTLY these keys):
              syrup, plain_solid, glitter, knit, chrome, mercury_chrome, magnetic_chrome, matte,
              ink, 3d_charm

            Material definitions:
            - syrup: translucent, juicy, glass-like syrup / jelly gel where the pigment looks suspended in
              clear gel. If ANY nail in the design uses syrup (the word "syrup" or "translucent syrup gel"
              appears, including syrup used as the base under glitter, chrome, or ink), you MUST include a
              syrup entry.
            - plain_solid: opaque, even solid-color gel (not syrup).
            - glitter: visible sparkle particles.
            - chrome: chrome powder, a full-cover mirror-like metallic chrome finish. This also covers
              pearlescent / aurora / "powder finish" (powder and chrome are the same material, always use
              the key "chrome", never "powder").
            - mercury_chrome: liquid mercury, liquid metal look.
            - magnetic_chrome: magnetic gel / magnetic cat eye.
            - matte: matte finish.
            - ink: ink gel, a vivid fully transparent colored gel (ink drawing, ink wash, ink check).
              (Classification only, so an ink nail is not mistaken for another texture.)
            - knit: knit / velvet gel filled with tiny fiber flecks.
            - 3d_charm: raised 3D charms. (Classification only.)

            Rules:
            - Extract only materials that genuinely appear in the prompt. Do NOT invent textures.
            - No duplicate texture entries (one entry per texture; use its most prominent color).
            - Techniques are NOT textures: gradient / ombre / french tip / cheek blush / marble / drawing /
              line art / dots / stripes / plaid / lace never get their own entry. Classify such a nail by the
              gel material underneath it: syrup if it is a translucent syrup gel, otherwise plain_solid.
            - Ignore negated mentions. Anything written as "Avoid: ...", "no X", "not X", "never X",
              "without X", "don't use X", "unless ...", or Korean "X 말고 / X 빼고 / X 넣지 마" is an
              exclusion, not a material of the design. Never create an entry for a texture that appears only
              in such a negation (for example "no matte" means matte is NOT used).
            - "color" and "color_hex" must be the MAIN BASE color of that material: the color that covers the
              largest area of the nails made with it. Never take the color of parts or decorations (charms,
              pearls, rhinestones, studs, chains), motifs, drawings or line art, french tip lines, or a tiny /
              faint accent (for example the barely visible end color of a gradient, or a small spot or drop of
              color). For gradient / ombre / cheek blush use the dominant base color, not the minor second color.
            - "color": that main base color as a descriptive English color name like
              "dusty rose pink", "ivory", "Hazelnut".
            - "color_hex": the same color as a 6-digit hex "#RRGGBB" (uppercase). It is REQUIRED for
              syrup, plain_solid, glitter, knit, matte, chrome, and magnetic_chrome, and is used to tint a base
              image, so give the real visible color of that material on the nail
              (for example silver chrome "#C0C0C0", champagne gold "#E8D3A2", soft pink syrup "#F4B6C6").
              Never output color names in color_hex.
            - mercury_chrome has no color: set color and color_hex to null.
            - Respond ONLY with a JSON array. No markdown, no explanation, no preamble.

            Output format:
            [
              {"texture": "syrup", "color": "soft pink", "color_hex": "#F4B6C6"},
              {"texture": "glitter", "color": "dusty rose pink", "color_hex": "#D9A3AB"},
              {"texture": "chrome", "color": "silver", "color_hex": "#C0C0C0"},
              {"texture": "plain_solid", "color": "warm beige", "color_hex": "#D8C3A5"}
            ]
            """;

    /** 프롬프트에 붙는 제외 절: 전역 "Avoid: no matte, no pink." 과 손톱별 " Avoid: ...". 마침표나 줄 끝까지 지운다. */
    private static final java.util.regex.Pattern AVOID_CLAUSE = java.util.regex.Pattern.compile("(?i)\\bAvoid:[^.\\n]*\\.?");

    public static String stripAvoidClauses(String prompt) {
        return prompt == null ? null : AVOID_CLAUSE.matcher(prompt).replaceAll("");
    }

    /** 키워드 앞(같은 절)에 이 단어가 있으면 "쓰지 않는다"는 부정 표현으로 본다. */
    private static final java.util.regex.Pattern NEGATION_WORD = java.util.regex.Pattern.compile(
            "(?i)\\b(no|not|never|without|avoid|unless|except|nor|don'?t|do not|doesn'?t)\\b|말고|빼고|제외|넣지|없이");

    /**
     * 프롬프트에 keyword가 부정 없이(긍정으로) 한 번이라도 나오는지. "no matte", "never as glitter specks",
     * "unless the design calls for glitter" 처럼 같은 절 앞쪽에 부정어가 있는 등장은 세지 않는다.
     * 절 경계: . ; , : 줄바꿈 ( ) — (키워드 앞 40자 안에서만 본다)
     */
    public static boolean mentionedPositively(String text, String keyword) {
        if (text == null || keyword == null || keyword.isBlank()) return false;
        String lower = text.toLowerCase();
        String k = keyword.toLowerCase();
        for (int i = lower.indexOf(k); i >= 0; i = lower.indexOf(k, i + 1)) {
            String window = lower.substring(Math.max(0, i - 40), i);
            int cut = -1;
            for (char b : new char[]{'.', ';', ',', ':', '\n', '(', ')', '—'}) cut = Math.max(cut, window.lastIndexOf(b));
            if (!NEGATION_WORD.matcher(window.substring(cut + 1)).find()) return true;
        }
        return false;
    }

    /**
     * 디자인 프롬프트에서 사용된 텍스처+컬러 쌍 목록을 추출한다.
     *
     * @param designPrompt NailDesignService가 조립한 최종 프롬프트 (buildCombinedPromptFromPlan 결과)
     * @return [{"texture": "glitter", "color": "dusty rose pink", "color_hex": "#D9A3AB"}, ...] 형태의 리스트
     */
    public List<Map<String, Object>> extractTextureColorPairs(String designPrompt) {
        // [Gemini 방식 - 주석 처리]
        // Map<String, Object> requestBody = Map.of(
        //         "contents", List.of(Map.of(
        //                 "role", "user",
        //                 "parts", List.of(Map.of("text", designPrompt))
        //         )),
        //         "systemInstruction", Map.of(
        //                 "parts", List.of(Map.of("text", SYSTEM_PROMPT))
        //         ),
        //         "generationConfig", Map.of(
        //                 "responseMimeType", "application/json",
        //                 "maxOutputTokens", 4096,
        //                 "thinkingConfig", Map.of("thinkingLevel", "LOW")
        //         )
        // );
        // JsonNode responseNode = callGeminiWithRetry(requestBody);
        // String text = responseNode.path("candidates").get(0)
        //         .path("content").path("parts").get(0).path("text").asText();

        // 응답 최상위가 배열이라 response_format=json_object(오브젝트 강제)를 쓸 수 없다 —
        // jsonObjectMode=false로 두고 프롬프트 지시(SYSTEM_PROMPT의 "Respond ONLY with a
        // JSON array")와 아래 markdown 코드펜스 제거 로직에 그대로 의존한다.
        // "Avoid: no matte" 같은 제외 절은 텍스처를 쓴다는 뜻이 아닌데 GPT가 "matte가 나왔다"고 읽는 일이 있어서 미리 지운다.
        String text = gptClientService.chat(SYSTEM_PROMPT, stripAvoidClauses(designPrompt), 4096, false);

        try {
            String cleaned = text.replaceAll("```json|```", "").trim();
            JsonNode arrayNode = objectMapper.readTree(cleaned);
            List<Map<String, Object>> result = new ArrayList<>();
            if (arrayNode.isArray()) {
                for (JsonNode item : arrayNode) {
                    Map<String, Object> pair = new java.util.LinkedHashMap<>();
                    String texture = item.path("texture").asText();

                    // 3D 참은 파츠라서, ink는 스와치 베이스 이미지가 아직 없어서 스와치를 만들지 않는다.
                    // 다른 텍스처로 잘못 분류되지 않도록 프롬프트의 분류 키에는 남겨두고, 결과에서만 뺀다.
                    if ("3d_charm".equals(texture) || "ink".equals(texture)) continue;

                    // powder는 chrome과 합쳐졌다 (같은 베이스 이미지를 쓰므로 여기서 먼저 통일해 중복을 막는다)
                    if ("powder".equals(texture)) texture = "chrome";

                    pair.put("texture", texture);
                    pair.put("color", item.has("color") && !item.get("color").isNull()
                            ? item.get("color").asText() : null);
                    pair.put("color_hex", item.has("color_hex") && !item.get("color_hex").isNull()
                            ? item.get("color_hex").asText() : null);
                    final String finalTexture = texture;
                    boolean alreadyExists = result.stream()
                            .anyMatch(p -> finalTexture.equals(p.get("texture")));
                    if (!alreadyExists) {
                        result.add(pair);
                    }
                }
            }
            System.out.println("[TextureExtractService] 추출된 텍스처 쌍: " + result);
            return result;
        } catch (Exception e) {
            System.err.println("[TextureExtractService] JSON 파싱 실패, 원본: " + text + " / 오류: " + e.getMessage());
            return List.of(); // 실패해도 메인 디자인 생성은 계속 진행
        }
    }

    // Gemini 호출 로직 - GPT(GptClientService)로 교체하면서 주석 처리 (롤백 대비, 삭제 안 함)
    // private JsonNode callGeminiWithRetry(Map<String, Object> requestBody) {
    //     WebClient webClient = webClientBuilder.build();
    //     int maxAttempts = 3;
    //     long backoffMillis = 1500;
    //
    //     for (int attempt = 1; attempt <= maxAttempts; attempt++) {
    //         try {
    //             return webClient.post()
    //                     .uri(apiUrl + "?key=" + apiKey.trim())
    //                     .bodyValue(requestBody)
    //                     .retrieve()
    //                     .bodyToMono(JsonNode.class)
    //                     .block();
    //         } catch (org.springframework.web.reactive.function.client.WebClientResponseException e) {
    //             int statusCode = e.getStatusCode().value();
    //             boolean isRetryable = statusCode == 429 || statusCode == 503;
    //             boolean hasAttemptsLeft = attempt < maxAttempts;
    //
    //             System.err.println("[TextureExtractService] Gemini 호출 실패 (시도 " + attempt
    //                     + "/" + maxAttempts + "): " + e.getStatusCode());
    //
    //             if (isRetryable && hasAttemptsLeft) {
    //                 try {
    //                     Thread.sleep(backoffMillis * attempt);
    //                 } catch (InterruptedException ie) {
    //                     Thread.currentThread().interrupt();
    //                 }
    //                 continue;
    //             }
    //             throw new IllegalStateException("텍스처 추출 중 AI 서버 오류: " + e.getStatusCode());
    //         }
    //     }
    //     throw new IllegalStateException("텍스처 추출 AI 응답 실패");
    // }
}