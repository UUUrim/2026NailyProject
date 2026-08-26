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
 * "어떤 텍스처+어떤 컬러"만 추출한 뒤 서버 쪽 템플릿(TextureSwatchService)에 매핑한다.
 *
 * Gemini 호출 패턴은 FingerDesignPlanService.callGeminiWithRetry()와 동일하게 구성함.
 */
@Service
@RequiredArgsConstructor
public class TextureExtractService {

    private final WebClient.Builder webClientBuilder;
    private final ObjectMapper objectMapper;

    @Value("${gemini.api.key}")
    private String apiKey;

    @Value("${gemini.api.url}")
    private String apiUrl;

    // test_texture_batch.py의 TEXTURE_KEYWORDS와 동일한 8종
    private static final String SYSTEM_PROMPT = """
            You are a nail art analyst. Given a nail design prompt, extract ONLY the textures
            and colors actually used in the design.

            Supported textures (use EXACTLY these keys):
              glitter, marble, magnetic_chrome, powder, matte, 3d_charm, plain_solid

            Rules:
            - Extract only textures that genuinely appear in the prompt. Do NOT invent textures.
            - No duplicate texture entries.
            - For 3d_charm: also include "charm_shape" (e.g. "bow", "heart", "star", "ribbon")
              and "charm_material" (e.g. "velvet", "crystal", "metallic", "glossy").
            - "color" should be the primary color associated with that texture in the design.
              Use descriptive English color names like "dusty rose pink", "ivory", "Hazelnut".
              Set color to null if the texture has its own inherent color (e.g. magnetic_chrome).
            - If a design has gradient/ombre/french/cheek → classify as plain_solid.
            - Respond ONLY with a JSON array. No markdown, no explanation, no preamble.

            Output format:
            [
              {"texture": "glitter", "color": "dusty rose pink"},
              {"texture": "plain_solid", "color": "ivory"},
              {"texture": "3d_charm", "color": null, "charm_shape": "bow", "charm_material": "velvet"}
            ]
            """;

    /**
     * 디자인 프롬프트에서 사용된 텍스처+컬러 쌍 목록을 추출한다.
     *
     * @param designPrompt NailDesignService가 조립한 최종 프롬프트 (buildCombinedPromptFromPlan 결과)
     * @return [{"texture": "glitter", "color": "pink"}, ...] 형태의 리스트
     */
    public List<Map<String, Object>> extractTextureColorPairs(String designPrompt) {
        Map<String, Object> requestBody = Map.of(
                "contents", List.of(Map.of(
                        "role", "user",
                        "parts", List.of(Map.of("text", designPrompt))
                )),
                "systemInstruction", Map.of(
                        "parts", List.of(Map.of("text", SYSTEM_PROMPT))
                ),
                "generationConfig", Map.of(
                        "responseMimeType", "application/json",
                        "maxOutputTokens", 1024,
                        "thinkingConfig", Map.of("thinkingLevel", "LOW")
                )
        );

        JsonNode responseNode = callGeminiWithRetry(requestBody);

        String text = responseNode.path("candidates").get(0)
                .path("content").path("parts").get(0).path("text").asText();

        try {
            String cleaned = text.replaceAll("```json|```", "").trim();
            JsonNode arrayNode = objectMapper.readTree(cleaned);
            List<Map<String, Object>> result = new ArrayList<>();
            int charmIndex = 1;
            if (arrayNode.isArray()) {
                for (JsonNode item : arrayNode) {
                    Map<String, Object> pair = new java.util.LinkedHashMap<>();
                    String texture = item.path("texture").asText();

                    //3d_charm 중복 처리
                    if ("3d_charm".equals(texture)) {
                        String charmShape = item.has("charm_shape")
                                ? item.get("charm_shape").asText().toLowerCase().replace(" ", "_")
                                : String.valueOf(charmIndex);
                        texture = charmIndex == 1 ? "3d_charm_" + charmShape : "3d_charm_" + charmShape + "_" + charmIndex;
                        charmIndex++;
                    }

                    pair.put("texture", texture);
                    pair.put("color", item.has("color") && !item.get("color").isNull()
                            ? item.get("color").asText() : null);
                    if (item.has("charm_shape")) {
                        pair.put("charm_shape", item.get("charm_shape").asText());
                    }
                    if (item.has("charm_material")) {
                        pair.put("charm_material", item.get("charm_material").asText());
                    }
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

    // FingerDesignPlanService.callGeminiWithRetry()와 동일한 패턴
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
                boolean isRetryable = statusCode == 429 || statusCode == 503;
                boolean hasAttemptsLeft = attempt < maxAttempts;

                System.err.println("[TextureExtractService] Gemini 호출 실패 (시도 " + attempt
                        + "/" + maxAttempts + "): " + e.getStatusCode());

                if (isRetryable && hasAttemptsLeft) {
                    try {
                        Thread.sleep(backoffMillis * attempt);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                    }
                    continue;
                }
                throw new IllegalStateException("텍스처 추출 중 AI 서버 오류: " + e.getStatusCode());
            }
        }
        throw new IllegalStateException("텍스처 추출 AI 응답 실패");
    }
}