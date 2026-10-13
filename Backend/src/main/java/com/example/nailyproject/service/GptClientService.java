package com.example.nailyproject.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.MediaType;
import org.springframework.http.client.MultipartBodyBuilder;
import org.springframework.stereotype.Service;
import org.springframework.util.MultiValueMap;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * OpenAI Chat Completions API 공용 클라이언트.
 * Gemini를 쓰던 ChatService/FingerDesignPlanService/RefineService/TextureExtractService가
 * 전부 이걸 통해 GPT를 호출한다 (텍스트 전용 프롬프트/JSON 생성 용도 — 이미지 "생성"이 아니라
 * 참고 이미지를 "읽는" 입력으로만 vision을 쓴다).
 */
@Service
@RequiredArgsConstructor
public class GptClientService {

    private final WebClient.Builder webClientBuilder;

    @Value("${openai.api.key}")
    private String apiKey;

    @Value("${openai.api.url:https://api.openai.com/v1/chat/completions}")
    private String apiUrl;

    @Value("${openai.api.model:gpt-4.1}")
    private String model;

    // 이미지 "생성" 전용 (텍스트/JSON용 Chat Completions와 별개 엔드포인트/모델) — 테스트 용도.
    @Value("${openai.api.image-url:https://api.openai.com/v1/images/generations}")
    private String imageApiUrl;

    @Value("${openai.api.image-model:gpt-image-2.5-sunburst}")
    private String imageModel;

    // 레퍼런스 이미지를 함께 보내는 이미지 생성(편집) 엔드포인트.
    @Value("${openai.api.image-edit-url:https://api.openai.com/v1/images/edits}")
    private String imageEditApiUrl;

    /**
     * system 프롬프트 + 대화 메시지(role은 "user"/"assistant")를 보내고 응답 텍스트를 그대로 돌려준다.
     *
     * @param jsonObjectMode true면 응답을 JSON 오브젝트로 강제한다(response_format=json_object).
     *                       OpenAI의 이 모드는 최상위가 반드시 오브젝트여야 하므로, 최상위가
     *                       배열이어야 하는 호출(TextureExtractService)은 false로 두고 프롬프트
     *                       지시에만 의존해야 한다.
     */
    public String chat(String systemPrompt, List<Map<String, Object>> messages,
                        int maxCompletionTokens, boolean jsonObjectMode) {
        List<Map<String, Object>> fullMessages = new ArrayList<>();
        fullMessages.add(Map.of("role", "system", "content", systemPrompt));
        fullMessages.addAll(messages);

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("model", model);
        requestBody.put("messages", fullMessages);
        requestBody.put("max_completion_tokens", maxCompletionTokens);
        if (jsonObjectMode) {
            requestBody.put("response_format", Map.of("type", "json_object"));
        }

        JsonNode responseNode = callWithRetry(requestBody);
        return responseNode.path("choices").get(0).path("message").path("content").asText();
    }

    /** 텍스트 하나만 보내는 단순 호출 (이미지 없음). */
    public String chat(String systemPrompt, String userText, int maxCompletionTokens, boolean jsonObjectMode) {
        return chat(systemPrompt, List.of(Map.of("role", "user", "content", userText)),
                maxCompletionTokens, jsonObjectMode);
    }

    /** 이미지(base64) + 텍스트를 함께 보내는 호출 (참고 이미지 분석용, 이미지 생성이 아님). */
    public String chatWithImage(String systemPrompt, String userText, String imageBase64,
                                 String imageMimeType, int maxCompletionTokens, boolean jsonObjectMode) {
        List<Map<String, Object>> content = List.of(
                Map.of("type", "text", "text", userText),
                Map.of("type", "image_url", "image_url",
                        Map.of("url", "data:" + imageMimeType + ";base64," + imageBase64))
        );
        List<Map<String, Object>> messages = List.of(Map.of("role", "user", "content", content));
        return chat(systemPrompt, messages, maxCompletionTokens, jsonObjectMode);
    }

    /**
     * [테스트 전용] GPT Image 2.5 Sunburst로 실제 이미지를 생성해서 base64(PNG)를 돌려준다.
     * 텍스트/JSON용 chat()과 완전히 다른 엔드포인트(images/generations)와 모델을 쓴다.
     *
     * @param prompt  FingerDesignPlanService/NailDesignService가 조립한 최종 이미지 프롬프트
     * @param size    예: "1536x1024"(가로형), "1024x1536"(세로형), "1024x1024", "auto"
     * @param quality "auto"/"low"/"medium"/"high" 등 (auto 권장)
     * @return base64 인코딩된 PNG 이미지
     */
    public String generateImage(String prompt, String size, String quality) {
        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("model", imageModel);
        requestBody.put("prompt", prompt);
        requestBody.put("size", size);
        requestBody.put("quality", quality);
        requestBody.put("n", 1);

        JsonNode responseNode = callWithRetry(requestBody, imageApiUrl);
        JsonNode dataArray = responseNode.path("data");
        if (!dataArray.isArray() || dataArray.isEmpty()) {
            throw new IllegalStateException("이미지 생성 응답에 data가 없습니다: " + responseNode);
        }
        String b64 = dataArray.get(0).path("b64_json").asText(null);
        if (b64 == null || b64.isBlank()) {
            throw new IllegalStateException("이미지 생성 응답에 b64_json이 없습니다: " + responseNode);
        }
        return b64;
    }

    /**
     * 레퍼런스 이미지(PNG 바이트)를 함께 보내서 이미지를 생성한다 (images/edits).
     * 레퍼런스는 프롬프트에 적은 역할(예: 광택만 참고)대로만 쓰이도록 프롬프트 쪽에서 제한해야 한다.
     */
    public String generateImageWithReferences(String prompt, String size, String quality, List<byte[]> references) {
        MultipartBodyBuilder builder = new MultipartBodyBuilder();
        builder.part("model", imageModel);
        builder.part("prompt", prompt);
        builder.part("size", size);
        builder.part("quality", quality);
        builder.part("n", "1");
        for (byte[] reference : references) {
            builder.part("image[]", new ByteArrayResource(reference))
                    .filename("reference.png")
                    .contentType(MediaType.IMAGE_PNG);
        }

        JsonNode responseNode = callWithRetry(builder.build(), imageEditApiUrl);
        JsonNode dataArray = responseNode.path("data");
        if (!dataArray.isArray() || dataArray.isEmpty()) {
            throw new IllegalStateException("이미지 생성 응답에 data가 없습니다: " + responseNode);
        }
        String b64 = dataArray.get(0).path("b64_json").asText(null);
        if (b64 == null || b64.isBlank()) {
            throw new IllegalStateException("이미지 생성 응답에 b64_json이 없습니다: " + responseNode);
        }
        return b64;
    }

    /** 텍스트/JSON용 chat completions 호출 (기본 apiUrl). */
    private JsonNode callWithRetry(Map<String, Object> requestBody) {
        return callWithRetry(requestBody, apiUrl);
    }

    /**
     * GPT 호출. 429(요청 한도 초과)나 5xx(서버 오류)면 잠깐 대기 후 최대 2회 재시도.
     */
    @SuppressWarnings("unchecked")
    private JsonNode callWithRetry(Object requestBody, String url) {
        // 기본 WebClient는 응답 바디를 256KB까지만 버퍼링한다. GPT Image 응답은 base64
        // PNG 전체가 JSON 안에 들어있어서 수 MB를 넘기기 쉬우므로, 버퍼 한도를 늘려야
        // 200 OK를 받고도 바디 디코딩 단계에서 실패하는 문제를 막을 수 있다.
        WebClient webClient = webClientBuilder
                .codecs(configurer -> configurer.defaultCodecs().maxInMemorySize(20 * 1024 * 1024))
                .build();
        int maxAttempts = 3;
        long backoffMillis = 1500;

        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                WebClient.RequestBodySpec spec = webClient.post()
                        .uri(url)
                        .header("Authorization", "Bearer " + apiKey.trim());
                WebClient.RequestHeadersSpec<?> request = requestBody instanceof MultiValueMap
                        ? spec.body(BodyInserters.fromMultipartData((MultiValueMap<String, ?>) requestBody))
                        : spec.bodyValue(requestBody);
                return request
                        .retrieve()
                        .bodyToMono(JsonNode.class)
                        .block();
            } catch (WebClientResponseException e) {
                int statusCode = e.getStatusCode().value();
                boolean isRetryable = statusCode == 429 || statusCode >= 500;
                boolean hasAttemptsLeft = attempt < maxAttempts;

                System.err.println("[GptClientService] OpenAI API 호출 실패 (시도 " + attempt + "/" + maxAttempts + "): "
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
                    throw new IllegalStateException("지금 AI 서버가 혼잡해서 응답이 지연되고 있어요. 잠시 후 다시 시도해 주세요.");
                }
                throw new IllegalStateException("AI 응답을 받아오지 못했어요. 잠시 후 다시 시도해 주세요.");
            }
        }
        throw new IllegalStateException("AI 응답을 받아오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
}
