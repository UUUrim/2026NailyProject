package com.example.nailyproject.service;

import com.example.nailyproject.dto.SlotData;
import com.example.nailyproject.dto.response.ChatResponseDto;
import com.example.nailyproject.entity.*;
import com.example.nailyproject.repository.*;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.util.*;

@Service
@Transactional
@RequiredArgsConstructor
public class ChatService {

    private final HandScanRepository handScanRepository;
    private final DesignSessionRepository designSessionRepository;
    private final ChatMessageRepository chatMessageRepository;
    private final WebClient.Builder webClientBuilder;
    private final ObjectMapper objectMapper;

    @Value("${gemini.api.key}")
    private String apiKey;

    @Value("${gemini.api.url}")
    private String apiUrl;


    private static final List<String> CATEGORIES =
            List.of("mood", "designType", "color", "season", "motif", "shape");

    private static final List<String> REQUIRED_FOR_COMPLETION =
            List.of("mood", "designType", "color", "season", "motif", "shape");

    private static final String SYSTEM_PROMPT_TEMPLATE = """
        당신은 Naily 서비스의 네일 디자인 전문 AI 어시스턴트입니다.
        사용자와 자유로운 순서로 대화하며 아래 카테고리별 선호(liked)/비선호(disliked)를 파악합니다:
        mood, designType, color, season, motif, shape

        사용자는 정확한 키워드가 아니라 일상적인 말, 비유, 상황 묘사로 취향을 표현할 수 있습니다.
        표면적 단어가 아니라 그 표현이 담고 있는 "느낌"을 해석해서 아래 규칙에 따라 변환하세요.

        [중요] slotActions의 value는 반드시 영어로 저장하세요 (한국어 저장 금지).
        reply(사용자에게 보여줄 응답)와 options는 한국어로 작성하되, value 자체는 영어로 변환하세요.
        공백 대신 하이픈(-)을 사용하세요 (예: "pastel pink" -> "pastel-pink").

        [카테고리별 허용 값]
        mood: lovely, simple, modern, chic, cute, kitschy, funky, feminine, elegant, pure, delicate, y2k (이 목록 안에서만 선택)
        designType: glitter, gradient, cheek, marble, french, magnetic, powder, matte, drawing, 3D (이 목록 안에서만 선택)
        color: 반드시 hex 코드로만 작성하세요 (예: #FFFFFF, #F5EFE9, #FF6B9D). 색상명이나 "스킨톤" 같은
               표현이 나와도 그 의미에 맞는 hex 값으로 직접 변환해서 저장하세요.
        motif: star, ribbon, floral, heart, crystal, pearl, swirl, polka-dot, butterfly, 
                water drop, shell, chain, geometric, animal print, none (이 목록 안에서만 선택)
        shape: almond, round, square, stiletto, ballerina, oval (이 목록 안에서만 선택)

        [season 카테고리 - 계절 또는 TPO(테마/이벤트/상황), 자유롭게 작성 가능]
        season은 정해진 목록이 없습니다. 계절이든 특정 테마/이벤트/상황이든, 사용자가 표현한
        의미를 살린 자연스러운 영어 단어로 직접 만들어서 저장하세요.
        예: "봄 느낌" -> spring, "크리스마스 느낌" -> christmas, "발렌타인 느낌" -> valentine,
            "생일 파티 느낌" -> birthday, "신년 느낌" -> new-year
        - "상관없다", "계절감 필요 없다" 같은 표현은 season: none으로 저장하세요.
        - season은 liked에 최대 2개까지 담을 수 있습니다.

        [해석 가이드 - 한국어 표현 -> 영어 값 변환 예시]
            mood: "현대인들이 할 법한/오피스룩" -> modern, "은은한/안 튀는" -> simple, "화려한/파티용" -> funky 또는 kitschy, "우아한/명품느낌" -> elegant, "청순한" -> pure
            designType: "반짝이는/빛나는" -> glitter, "색이 번지는" -> gradient, "깔끔한 흰 팁" -> french, "대리석 무늬" -> marble, "손그림 느낌/일러스트" -> drawing, "입체적인/도드라진" -> 3D
            color: "가을느낌/단풍색" -> #A0522D 계열, "청순한/웨딩" -> #FFFFFF 또는 #FFD1DC, "스킨톤" -> #F5EFE9 계열
            motif: "플라워/꽃무늬" -> floral
            
        [중요]
        - 확신이 안 서면 억지로 추측해서 반영하지 말고, reply에서 선택지를 주며 되물어보세요.
        - 부정적 표현(예: "~는 싫어요", "~빼고")은 add_dislike 또는 remove_like로 처리하세요.
        - 이미 선호했던 걸 취소하고 다른 걸 원하면: remove_like(기존값) + add_like(새값)
        - liked/disliked에 같은 값이 동시에 있으면 안 됩니다(add_like 시 자동으로 disliked에서 제거됨).

        [현재까지 파악된 선호/비선호 상태]
        %s

        [아직 안 채워진 필수 카테고리]
        %s

        mood, designType, color, season, motif, shape 이 6개 카테고리가 모두 채워져야 완료됩니다.
        (motif는 "없음"을 원하면 motif: none으로 채워도 완료로 인정합니다.
         shape도 사용자가 특별히 원하는 게 없으면 어울리는 값을 추천해서 채워도 됩니다.)
        아직 안 채워진 카테고리 중 하나를 자연스럽게 물어보고, 모두 채워지면 isComplete를 true로
        설정하세요. 사용자가 망설이는 것 같으면, 이미 파악된 선호를 참고해 짧은 추천 문구를
        reply에 포함하세요.

        반드시 아래 JSON 형식으로만 응답하세요. 마크다운 없이 순수 JSON만 반환합니다.
        {
            "reply": "사용자에게 보여줄 한국어 응답",
            "slotActions": [
                {"category": "mood", "action": "add_like", "value": "modern"}
            ],
            "nextQuestionTarget": "color",
            "showOptions": true,
            "options": ["옵션1(한국어)", "옵션2(한국어)"],
            "isComplete": false
        }
        """;

    public DesignSession createSession(User user) {
        DesignSession session = DesignSession.builder()
                .user(user)
                .handScan(null)
                .build();
        return designSessionRepository.save(session);
    }

    public ChatResponseDto chat(User user, Long sessionId, String userMessage) {

        DesignSession session = designSessionRepository.findByIdAndUserId(sessionId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 채팅 세션을 찾을 수 없습니다."));

        Map<String, SlotData> slots = loadSlots(session.getExtractedPreferences());

        List<String> emptyRequiredCategories = REQUIRED_FOR_COMPLETION.stream()
                .filter(cat -> !slots.containsKey(cat) || slots.get(cat).getLiked().isEmpty())
                .toList();

        List<ChatMessage> savedMessages = chatMessageRepository.findBySessionOrderBySentAtAsc(session);
        List<Map<String, Object>> contents = new ArrayList<>();
        for (ChatMessage msg : savedMessages) {
            String role = (msg.getRole() == ChatMessage.MessageRole.user) ? "user" : "model";
            contents.add(Map.of("role", role, "parts", List.of(Map.of("text", msg.getContent()))));
        }
        contents.add(Map.of("role", "user", "parts", List.of(Map.of("text", userMessage))));

        String slotsJson;
        try {
            slotsJson = objectMapper.writeValueAsString(slots);
        } catch (JsonProcessingException e) {
            slotsJson = "{}";
        }
        String systemPrompt = String.format(
                SYSTEM_PROMPT_TEMPLATE, slotsJson, String.join(", ", emptyRequiredCategories));

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("contents", contents);
        requestBody.put("systemInstruction", Map.of("parts", List.of(Map.of("text", systemPrompt))));

        //Gemini에게 무조건 JSON으로 응답하도록 강제하는 설정
        //응답이 중간에 잘리지 않도록 출력 토큰을 넉넉히 확보하고, 간단한 대화라 thinking 예산은 낮춤
        requestBody.put("generationConfig", Map.of(
                "responseMimeType", "application/json",
                "maxOutputTokens", 4096,
                "thinkingConfig", Map.of("thinkingLevel", "LOW")
        ));

        JsonNode responseNode = callGeminiWithRetry(requestBody);

        String aiResponseText = "";
        if (responseNode != null && responseNode.has("candidates")) {
            aiResponseText = responseNode.path("candidates").get(0)
                    .path("content").path("parts").get(0)
                    .path("text").asText();
        }

        String reply;
        String nextQuestionTarget = null;
        boolean showOptions = false;
        List<String> options = new ArrayList<>();
        boolean isComplete = false;

        try {
            JsonNode resultJson = objectMapper.readTree(aiResponseText);
            reply = resultJson.get("reply").asText();

            JsonNode actions = resultJson.get("slotActions");
            if (actions != null && actions.isArray()) {
                applySlotActions(slots, actions);
            }

            if (resultJson.has("nextQuestionTarget") && !resultJson.get("nextQuestionTarget").isNull()) {
                nextQuestionTarget = resultJson.get("nextQuestionTarget").asText();
            }
            if (resultJson.has("showOptions")) {
                showOptions = resultJson.get("showOptions").asBoolean();
            }
            if (resultJson.has("options") && resultJson.get("options").isArray()) {
                resultJson.get("options").forEach(o -> options.add(o.asText()));
            }
            if (resultJson.has("isComplete")) {
                isComplete = resultJson.get("isComplete").asBoolean();
            }
            if (isComplete) {
                session.updateStatus(DesignSession.SessionStatus.COMPLETED);
            }

            session.updateExtractedPreferences(objectMapper.writeValueAsString(slots));

        } catch (JsonProcessingException e) {
            System.err.println("Gemini 응답 JSON 파싱 실패. 원본 응답: " + aiResponseText);
            e.printStackTrace();
            // 완전히 실패 문구만 보여주기 전에, 잘린 응답에서라도 "reply" 값을 최대한 살려봄
            String salvaged = salvageReply(aiResponseText);
            reply = salvaged != null ? salvaged : "죄송합니다. 응답을 처리하는 중 오류가 발생했습니다.";
        }

        chatMessageRepository.save(ChatMessage.builder()
                .session(session).role(ChatMessage.MessageRole.user).content(userMessage).build());
        chatMessageRepository.save(ChatMessage.builder()
                .session(session).role(ChatMessage.MessageRole.assistant).content(reply).build());

        return ChatResponseDto.builder()
                .reply(reply)
                .nextQuestionTarget(nextQuestionTarget)
                .showOptions(showOptions)
                .options(options)
                .isComplete(isComplete)
                .build();
    }

    private Map<String, SlotData> loadSlots(String json) {
        if (json == null || json.isBlank()) return new HashMap<>();
        try {
            return objectMapper.readValue(json, new TypeReference<Map<String, SlotData>>() {});
        } catch (JsonProcessingException e) {
            return new HashMap<>();
        }
    }

    private void applySlotActions(Map<String, SlotData> slots, JsonNode actions) {
        for (JsonNode action : actions) {
            String category = action.get("category").asText();
            String actionType = action.get("action").asText();
            String value = action.get("value").asText();

            SlotData slot = slots.computeIfAbsent(category, k -> new SlotData());

            switch (actionType) {
                case "add_like" -> {
                    if (!slot.getLiked().contains(value)) slot.getLiked().add(value);
                    slot.getDisliked().remove(value);
                }
                case "add_dislike" -> {
                    if (!slot.getDisliked().contains(value)) slot.getDisliked().add(value);
                    slot.getLiked().remove(value);
                }
                case "remove_like" -> slot.getLiked().remove(value);
                case "remove_dislike" -> slot.getDisliked().remove(value);
            }
        }
    }

    /**
     * Gemini 호출. 429(요청 한도 초과)면 잠깐 대기 후 최대 2회 재시도.
     * 그래도 실패하면 프론트가 "로그인 세션 만료"로 오인하지 않도록 IllegalStateException으로 변환.
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
            } catch (WebClientResponseException e) {
                boolean isRateLimited = e.getStatusCode().value() == 429;
                boolean hasAttemptsLeft = attempt < maxAttempts;

                System.err.println("Gemini API 호출 실패 (시도 " + attempt + "/" + maxAttempts + "): "
                        + e.getStatusCode() + " " + e.getResponseBodyAsString());

                if (isRateLimited && hasAttemptsLeft) {
                    try {
                        Thread.sleep(backoffMillis * attempt); // 1.5초, 3초 ...로 점점 늘려가며 재시도
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                    }
                    continue;
                }

                if (isRateLimited) {
                    throw new IllegalStateException("지금 요청이 많아 AI 응답이 지연되고 있어요. 잠시 후 다시 시도해 주세요.");
                }
                throw new IllegalStateException("AI 응답을 받아오지 못했어요. 잠시 후 다시 시도해 주세요.");
            }
        }
        throw new IllegalStateException("AI 응답을 받아오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }

    /**
     * Gemini 응답이 중간에 잘려 JSON 파싱이 실패했을 때, "reply" 필드 값만이라도
     * 정규식으로 최대한 살려서 사용자에게 자연스러운 답을 보여주기 위한 폴백.
     * 완전히 실패하면 null을 반환한다.
     */
    private String salvageReply(String truncatedJson) {
        if (truncatedJson == null || truncatedJson.isBlank()) return null;
        java.util.regex.Matcher matcher =
                java.util.regex.Pattern.compile("\"reply\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)").matcher(truncatedJson);
        if (matcher.find()) {
            String raw = matcher.group(1);
            // JSON 이스케이프 문자 최소한으로 복원 (\n, \", \\)
            return raw.replace("\\n", "\n").replace("\\\"", "\"").replace("\\\\", "\\");
        }
        return null;
    }
}