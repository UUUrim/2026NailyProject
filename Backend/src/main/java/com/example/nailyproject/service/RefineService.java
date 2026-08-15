package com.example.nailyproject.service;

import com.example.nailyproject.dto.SlotData;
import com.example.nailyproject.entity.ChatMessage;
import com.example.nailyproject.entity.DesignSession;
import com.example.nailyproject.entity.NailDesign;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.ChatMessageRepository;
import com.example.nailyproject.repository.DesignSessionRepository;
import com.example.nailyproject.repository.NailDesignRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * "수정하고 싶어요" 흐름 전용: 이미 확정된 디자인에 대한 사용자의 수정 요청을 해석해서,
 * ChatService와 동일한 slotActions(category/action/value) 스키마로 세션의 extractedPreferences에
 * 직접 반영한다. (예전 버전은 카테고리 구분 없는 키워드 리스트를 refineKeywords 컬럼에
 * 저장만 하고 아무도 읽지 않아서, 수정 요청이 실제로는 반영되지 않는 문제가 있었다.)
 */
@Service
@Transactional
@RequiredArgsConstructor
public class RefineService {

    private final DesignSessionRepository designSessionRepository;
    private final NailDesignRepository nailDesignRepository;
    private final ChatMessageRepository chatMessageRepository;
    private final WebClient.Builder webClientBuilder;
    private final ObjectMapper objectMapper;

    @Value("${gemini.api.key}")
    private String apiKey;

    @Value("${gemini.api.url}")
    private String apiUrl;

    private static final Pattern HEX_PATTERN = Pattern.compile("^#[0-9A-Fa-f]{6}$");

    private static final String SYSTEM_PROMPT_TEMPLATE = """
            당신은 이미 한 번 완성된 네일 디자인을, 사용자의 "수정 요청"에 맞게
            바꾸는 역할입니다. 처음부터 새로 취향을 묻는 게 아니라, 아래에 주어진
            "지금까지 확정된 디자인 정보"와 "직전 손가락별 플랜"을 기준으로 사용자가
            방금 말한 부분만 바꾸세요.

            [카테고리]
            mood, designType, color, season, motif, shape

            [핵심 규칙]
            - "~로 바꿔줘", "~하게 해줘", "~였으면 좋겠어" 같은 요청은 해당 카테고리에
              add_like로 새 값을 반영하세요. 기존 값을 대체하는 것이므로, 그 카테고리의
              예전 값과 헷갈리지 않게 새 값 하나만 명확히 넣으세요.
            - "~는 빼줘", "~말고", "~는 싫어", "~없이" 같은 제거/부정 표현은 절대 무시하지 말고
              add_dislike로 반영하세요. (예: "하트 모티프를 빼줘" -> motif, add_dislike, "heart")
            - color는 반드시 hex(#RRGGBB) 형식으로만 작성하세요. "빨간색"처럼 이름으로 쓰지 마세요.
              색 이름만 언급되고 정확한 톤이 불분명하면, 그 이름에 가장 대표적인 hex를 골라 쓰세요.
            - "엄지만 ~로 해줘", "네 번째 손가락은 ~ 빼줘"처럼 사용자가 손가락을 직접 지목한
              요청이면, 해당 손가락 지정을 fingerOverrides(원하는 스타일) 또는 fingerDislikes
              (피할 것)에 자연스러운 영어로 넣으세요.
            - [매우 중요] 사용자가 손가락을 직접 지목하지 않았어도, "직전 손가락별 플랜"을
              보고 그 요청이 특정 손가락 1~2개에만 해당되는 요소라면(예: "별 모양 빼줘"인데
              직전 플랜에서 별 모양이 ring 손가락에만 있었다면), 그 요청은 사실상 그 손가락에
              대한 요청입니다. 이 경우 slotActions로 전역 처리만 하지 말고, 반드시
              fingerDislikes/fingerOverrides에도 해당 손가락(ring 등)을 명시해서
              "그 손가락의 parts/design_type을 실제로 다시 써야 한다"는 것을 알리세요.
              그래야 전역 negative 문구("no star")만 붙고 그 손가락 자체 설명은 그대로
              남아서 서로 모순되는 문제를 막을 수 있습니다.
            - 언급되지 않은 카테고리는 slotActions에 아예 넣지 마세요 (건드리지 않고 그대로 유지).
            - value는 전부 영어로 작성하세요. reply 같은 건 필요 없습니다.

            [지금까지 확정된 디자인 정보]
            %s

            [직전 손가락별 플랜 (참고용 - 여기서 어느 손가락에 뭐가 있었는지 확인하세요)]
            %s

            반드시 아래 JSON 형식으로만 응답하세요. 마크다운 없이 순수 JSON만 반환합니다.
            {
                "slotActions": [
                    {"category": "designType", "action": "add_like", "value": "matte"},
                    {"category": "motif", "action": "add_dislike", "value": "heart"}
                ],
                "fingerOverrides": {"ring": "replace the star-shaped charm with a bubble-shaped charm"},
                "fingerDislikes": {"ring": ["star"]}
            }
            """;

    /**
     * 사용자의 수정 요청 자유 입력을 받아 slotActions로 해석하고,
     * 세션의 extractedPreferences/fingerOverrides/fingerDislikes에 바로 반영한다.
     * POST /chats/{sessionId}/refine
     *
     * @return 실제로 적용된 변경 내역을 사람이 읽을 수 있는 문자열 목록으로 반환
     *         (프론트는 지금 이 반환값 자체를 쓰진 않지만, 디버깅/로그용으로 남겨둔다)
     */
    public List<String> applyRevision(User user, Long sessionId, String message) {
        DesignSession session = designSessionRepository.findByIdAndUserId(sessionId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 채팅 세션을 찾을 수 없습니다."));

        Map<String, SlotData> slots = loadSlots(session.getExtractedPreferences());

        String slotsJson;
        try {
            slotsJson = objectMapper.writeValueAsString(slots);
        } catch (Exception e) {
            slotsJson = "{}";
        }

        String previousPlanJson = nailDesignRepository.findTopBySessionIdOrderByGeneratedAtDesc(sessionId)
                .map(NailDesign::getDesignPlan)
                .filter(p -> p != null && !p.isBlank())
                .orElse("(직전 플랜 없음)");

        String systemPrompt = String.format(SYSTEM_PROMPT_TEMPLATE, slotsJson, previousPlanJson);

        Map<String, Object> requestBody = Map.of(
                "contents", List.of(Map.of("role", "user", "parts", List.of(Map.of("text", message)))),
                "systemInstruction", Map.of("parts", List.of(Map.of("text", systemPrompt))),
                "generationConfig", Map.of(
                        "responseMimeType", "application/json",
                        "maxOutputTokens", 1024,
                        "thinkingConfig", Map.of("thinkingLevel", "LOW")
                )
        );

        JsonNode responseNode = callGeminiWithRetry(requestBody);

        String aiResponseText;
        try {
            aiResponseText = responseNode.path("candidates").get(0)
                    .path("content").path("parts").get(0).path("text").asText();
        } catch (Exception e) {
            System.err.println("수정 요청 응답에서 텍스트를 못 찾음: " + responseNode);
            return List.of();
        }

        JsonNode resultJson;
        try {
            resultJson = objectMapper.readTree(aiResponseText);
        } catch (Exception e) {
            System.err.println("수정 요청 JSON 파싱 실패. 원본 응답: " + aiResponseText);
            // 파싱에 실패해도 기존 슬롯 그대로 재생성이 진행되도록, 예외를 던지지 않고 조용히 넘어간다.
            return List.of();
        }

        List<String> appliedChanges = applySlotActions(slots, resultJson.path("slotActions"));

        try {
            session.updateExtractedPreferences(objectMapper.writeValueAsString(slots));
        } catch (Exception e) {
            System.err.println("수정된 슬롯 직렬화 실패: " + e.getMessage());
        }

        mergeFingerOverrides(resultJson.path("fingerOverrides"), session.getFingerOverrides(), session::updateFingerOverrides);
        mergeFingerDislikes(resultJson.path("fingerDislikes"), session.getFingerDislikes(), session::updateFingerDislikes);

        designSessionRepository.save(session);

        // 이 수정 요청도 채팅 이력에 남겨야, 나중에 마이페이지에서 "채팅 이력 보기"로
        // 다시 볼 때 이 turn이 빠지지 않는다. (예전엔 슬롯 반영만 하고 메시지 저장을
        // 안 해서, 재생성 전 수정 요청 대화가 재연에서 통째로 누락되는 문제가 있었다.)
        chatMessageRepository.save(ChatMessage.builder()
                .session(session)
                .role(ChatMessage.MessageRole.user)
                .content(message)
                .build());
        chatMessageRepository.save(ChatMessage.builder()
                .session(session)
                .role(ChatMessage.MessageRole.assistant)
                .content(appliedChanges.isEmpty()
                        ? "네, 알겠습니다! 요청하신 내용으로 다시 만들어드릴게요."
                        : "네, 알겠습니다! 말씀하신 대로 반영해서 다시 만들어드릴게요.")
                .build());

        return appliedChanges;
    }

    private Map<String, SlotData> loadSlots(String extractedPreferencesJson) {
        if (extractedPreferencesJson == null || extractedPreferencesJson.isBlank()) return new HashMap<>();
        try {
            return objectMapper.readValue(extractedPreferencesJson,
                    objectMapper.getTypeFactory().constructMapType(HashMap.class, String.class, SlotData.class));
        } catch (Exception e) {
            System.err.println("extractedPreferences 파싱 실패, 빈 슬롯으로 진행: " + extractedPreferencesJson);
            return new HashMap<>();
        }
    }

    /**
     * slotActions를 슬롯 맵에 반영한다. "수정" 의도이므로, add_like는 그 카테고리의
     * 기존 liked 값을 교체(성립하지 않는 조합이 같이 남지 않도록)하고, add_dislike는
     * disliked 목록에 추가한다(상충하는 liked 값이 있으면 제거).
     */
    private List<String> applySlotActions(Map<String, SlotData> slots, JsonNode slotActionsNode) {
        List<String> applied = new ArrayList<>();
        if (slotActionsNode == null || !slotActionsNode.isArray()) return applied;

        for (JsonNode action : slotActionsNode) {
            String category = action.path("category").asText("");
            String actionType = action.path("action").asText("");
            String value = action.path("value").asText("");
            if (category.isBlank() || actionType.isBlank() || value.isBlank()) continue;

            if ("color".equals(category) && !HEX_PATTERN.matcher(value.trim()).matches()) {
                System.err.println("수정 요청의 색상 값이 hex 형식이 아니라 무시함: " + value);
                continue;
            }

            SlotData slot = slots.computeIfAbsent(category, k -> new SlotData());

            if ("add_like".equals(actionType)) {
                slot.getLiked().clear();
                slot.getLiked().add(value);
                slot.getDisliked().remove(value);
                applied.add(category + ": " + value + " (좋아함으로 반영)");
            } else if ("add_dislike".equals(actionType)) {
                if (!slot.getDisliked().contains(value)) slot.getDisliked().add(value);
                slot.getLiked().remove(value);
                applied.add(category + ": " + value + " (제외로 반영)");
            }
        }
        return applied;
    }

    /**
     * fingerOverrides/fingerDislikes는 손가락별 자유 텍스트 JSON 객체다.
     * 새로 받은 지정을 기존 값 위에 덮어써서 병합한다 (같은 손가락이면 새 지정이 우선).
     */
    /** fingerOverrides: 손가락별 값이 문자열 하나("이 손가락은 이렇게 해줘")인 JSON 객체. 새 지정이 기존 값을 대체. */
    private void mergeFingerOverrides(JsonNode newNode, String existingJson, java.util.function.Consumer<String> updater) {
        if (newNode == null || !newNode.isObject() || newNode.isEmpty()) return;

        Map<String, String> merged = new HashMap<>();
        if (existingJson != null && !existingJson.isBlank()) {
            try {
                JsonNode existingNode = objectMapper.readTree(existingJson);
                existingNode.fields().forEachRemaining(entry -> merged.put(entry.getKey(), entry.getValue().asText()));
            } catch (Exception ignored) {
            }
        }
        newNode.fields().forEachRemaining(entry -> merged.put(entry.getKey(), entry.getValue().asText()));

        try {
            updater.accept(objectMapper.writeValueAsString(merged));
        } catch (Exception e) {
            System.err.println("손가락별 지정 병합 실패: " + e.getMessage());
        }
    }

    /** fingerDislikes: 손가락별 값이 문자열 배열(["star", ...])인 JSON 객체. 기존 배열에 새 값을 합집합으로 추가. */
    private void mergeFingerDislikes(JsonNode newNode, String existingJson, java.util.function.Consumer<String> updater) {
        if (newNode == null || !newNode.isObject() || newNode.isEmpty()) return;

        Map<String, List<String>> merged = new HashMap<>();
        if (existingJson != null && !existingJson.isBlank()) {
            try {
                JsonNode existingNode = objectMapper.readTree(existingJson);
                existingNode.fields().forEachRemaining(entry -> {
                    List<String> items = new ArrayList<>();
                    entry.getValue().forEach(v -> items.add(v.asText()));
                    merged.put(entry.getKey(), items);
                });
            } catch (Exception ignored) {
            }
        }
        newNode.fields().forEachRemaining(entry -> {
            List<String> items = merged.computeIfAbsent(entry.getKey(), k -> new ArrayList<>());
            entry.getValue().forEach(v -> {
                String text = v.asText();
                if (!items.contains(text)) items.add(text);
            });
        });

        try {
            updater.accept(objectMapper.writeValueAsString(merged));
        } catch (Exception e) {
            System.err.println("손가락별 비선호 병합 실패: " + e.getMessage());
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
                boolean isRetryable = statusCode == 429 || statusCode == 503;
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
                throw new IllegalStateException("수정 요청 처리용 AI 응답을 받아오지 못했어요. 잠시 후 다시 시도해 주세요.");
            }
        }
        throw new IllegalStateException("수정 요청 처리용 AI 응답을 받아오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
}