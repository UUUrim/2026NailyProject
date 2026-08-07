package com.example.nailyproject.service;

import com.example.nailyproject.entity.DesignSession;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.DesignSessionRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

//자유입력 받아서 키워드 추출 및 session.generatedPrompt에 저장만 하는 용도
@Service
@Transactional
@RequiredArgsConstructor
public class RefineService {

    private final DesignSessionRepository designSessionRepository;
    private final WebClient.Builder webClientBuilder;
    private final ObjectMapper objectMapper;

    @Value("${gemini.api.key}")
    private String apiKey;

    @Value("${gemini.api.url}")
    private String apiUrl;

    private static final String SYSTEM_PROMPT = """
            당신은 네일 디자인 키워드 추출 전문가입니다.
            사용자의 자유로운 입력에서 아래 [매핑 가이드]를 참고하여 허용된 키워드만 추출해주세요.
            부정적인 표현(싫어, 없었으면 등)은 무시하고 긍정적인 키워드만 추출합니다.
            
            [매핑 가이드]
            1. 무드(mood):
               - "귀여운, 사랑스러운, 핑크" -> lovely, cute
               - "깔끔한, 단순한, 미니멀" -> simple
               - "세련된, 도시적, 오피스" -> modern, chic
               - "화려한, 눈에 띄는" -> funky, kitschy
               - "우아한, 고급스러운" -> elegant, feminine
               - "청순한, 순한, 내추럴" -> pure, delicate
            2. 디자인(designType):
               - "그라데이션, 그러데이션, 옴브레" -> gradient
               - "반짝이, 글리터, 빛나는" -> glitter
               - "프렌치, 프렌치팁" -> french
               - "마블, 대리석" -> marble
               - "파우더" -> powder
               - "자석" -> magnetic
               - "치크" -> cheek
               - "무광, 매트" -> matte
            3. 계절(season):
               - "봄, 벚꽃, 파스텔" -> spring
               - "여름, 휴가, 바다, 시원한" -> summer
               - "가을, 단풍, 따뜻한 느낌" -> autumn
               - "겨울, 크리스마스, 눈" -> winter
            4. 모티프(motif):
               - star, ribbon, floral, heart, crystal, pearl, swirl, polka dot 등
            5. 쉐입(shape):
               - almond, round, square, stiletto, ballerina, oval
            
            애매하거나 감지되지 않는 항목은 생략하세요.
            반드시 아래 JSON 형식으로만 응답하세요. 마크다운 없이 순수 JSON만 반환하세요.
            {
                "keywords": ["추출된키워드1", "추출된키워드2"]
            }
            
            추출된 키워드가 없으면:
            {
                "keywords": []
            }
            """;

    /**
     * 사용자 자유 입력에서 키워드 추출 POST /chats/{sessionId}/refine
     */
    public List<String> extractKeywords(User user, Long sessionId, String message) {

        // 세션 조회
        DesignSession session = designSessionRepository.findByIdAndUserId(sessionId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 채팅 세션을 찾을 수 없습니다."));

        // Gemini 요청 구성
        List<Map<String, Object>> contents = List.of(
                Map.of("role", "user",
                        "parts", List.of(Map.of("text", message)))
        );

        Map<String, Object> requestBody = Map.of(
                "contents", contents,
                "systemInstruction", Map.of(
                        "parts", List.of(Map.of("text", SYSTEM_PROMPT))
                ),
                "generationConfig", Map.of(
                        "responseMimeType", "application/json",
                        "maxOutputTokens", 1024,
                        "thinkingConfig", Map.of("thinkingLevel", "LOW")
                )
        );

        // Gemini 호출 (429는 잠깐 대기 후 재시도)
        JsonNode responseNode = callGeminiWithRetry(requestBody);

        // 응답 파싱
        List<String> keywords = new ArrayList<>();
        String aiResponseText = "";
        try {
            aiResponseText = responseNode.path("candidates").get(0)
                    .path("content").path("parts").get(0)
                    .path("text").asText();

            JsonNode resultJson = objectMapper.readTree(aiResponseText);
            JsonNode keywordsNode = resultJson.get("keywords");

            if (keywordsNode != null && keywordsNode.isArray()) {
                keywordsNode.forEach(k -> keywords.add(k.asText()));
            }
        } catch (JsonProcessingException e) {
            System.err.println("Gemini 키워드 추출 JSON 파싱 실패. 원본 응답: " + aiResponseText);
            throw new RuntimeException("키워드 추출 중 오류가 발생했습니다.");
        }

        // 5. ★ [핵심] JSON 배열로 변환 후 정확한 컬럼에 병합 저장 및 DB 커밋 ★
        if (!keywords.isEmpty()) {
            try {
                List<String> combinedKeywords = new ArrayList<>();
                String existingJson = session.getRefineKeywords();

                // 기존 키워드 불러오기
                if (existingJson != null && !existingJson.isBlank()) {
                    JsonNode existingNode = objectMapper.readTree(existingJson);
                    existingNode.forEach(k -> combinedKeywords.add(k.asText()));
                }

                // 새 키워드 중복 없이 추가
                for (String newKey : keywords) {
                    if (!combinedKeywords.contains(newKey)) {
                        combinedKeywords.add(newKey);
                    }
                }

                // 엔티티 업데이트 (updateRefineKeywords 사용!)
                session.updateRefineKeywords(objectMapper.writeValueAsString(combinedKeywords));

                // DB 강제 저장 (이게 있어야 NailDesignService로 넘어갑니다)
                designSessionRepository.save(session);

                return combinedKeywords;

            } catch (JsonProcessingException e) {
                throw new RuntimeException("키워드 병합 저장 중 오류가 발생했습니다.");
            }
        }

        return keywords;

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
                    throw new IllegalStateException("지금 AI 서버가 혼잡해서 응답이 지연되고 있어요. 잠시 후 다시 시도해 주세요.");
                }
                throw new IllegalStateException("키워드 추출용 AI 응답을 받아오지 못했어요. 잠시 후 다시 시도해 주세요.");
            }
        }
        throw new IllegalStateException("키워드 추출용 AI 응답을 받아오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }

}