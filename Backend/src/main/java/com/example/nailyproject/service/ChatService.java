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
@RequiredArgsConstructor
public class ChatService {

    private final HandScanRepository handScanRepository;
    private final DesignSessionRepository designSessionRepository;
    private final ChatMessageRepository chatMessageRepository;
    private final WebClient.Builder webClientBuilder;
    private final ObjectMapper objectMapper;
    private final StyleTrendService styleTrendService;  // 추가

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
            \s
                     사용자는 정확한 키워드가 아니라 일상적인 말, 비유, 상황 묘사로 취향을 표현할 수 있습니다.
                     표면적 단어가 아니라 그 표현이 담고 있는 "느낌"을 해석해서 자연스러운 영어로 변환하세요.
            \s
                     [중요] slotActions의 value는 반드시 영어로 저장하세요 (한국어 저장 금지).
                     reply(사용자에게 보여줄 응답)와 options는 한국어로 작성하되, value 자체는 영어로 변환하세요.
            \s
                     [shape 카테고리 - 유일하게 고정 목록이 있는 카테고리]
                     shape: almond, round, square, stiletto, ballerina, oval (이 목록 안에서만 선택)
                     [중요 - options 개수 제한]
                      options 배열은 항상 최대 3개까지만 제시하세요. 특히 shape처럼 고정 목록이
                      6개나 있어도, 전부 나열하지 말고 지금까지의 대화 맥락과 아래 스캔 기반 힌트를
                      참고해서 가장 어울리는 후보 3개만 추천하세요. color도 마찬가지로 힌트가
                      있으면 참고해서 제시하세요.
                      [중요 - options 라벨 언어]
                      options 배열의 각 항목은 순수 한국어 단어/구로만 작성하세요. 영어 단어나
                      괄호 병기("동근 모양 (Round)"처럼)를 절대 섞지 마세요. shape 카테고리는
                      "스퀘어", "오발", "라운드", "아몬드", "스틸레토", "발레리나"처럼, 고정 UI에서
                      쓰는 것과 동일한 한국어 명칭만 사용하세요.
                      %s    
            \s
                     [mood, designType, color, motif 카테고리 - 자유롭게 작성 가능]
                     이 4개 카테고리는 정해진 목록이 없습니다. 사용자가 표현한 의미를 살린 자연스러운
                     영어 단어나 짧은 구로 직접 만들어서 저장하세요. 개수 제한도 없습니다 - 사용자가
                     여러 개를 언급하면 각각 별도의 add_like 액션으로 모두 저장하세요.
            \s
                     - mood: 분위기/느낌. 예: "현대인들이 할 법한/오피스룩" -> modern, "화려한/파티용" -> funky and glamorous, "우아한/명품느낌" -> elegant, "청순한" -> pure and innocent
                     - designType: 디자인 기법/스타일. 예: "반짝이는/빛나는" -> glitter, "색이 번지는" -> gradient, "깔끔한 흰 팁" -> french tip, "대리석 무늬" -> marble, "손그림 느낌" -> hand-drawn, "입체적인" -> 3D sculpture
                     - color: 반드시 "#"으로 시작하는 6자리 hex 코드로 저장하세요 (색상 이름 절대 금지).
                                 "스킨톤"이라고 하면 그 의미에 맞는 hex 값(예: #F5EFE9)을 직접 계산해서 넣으세요.
                                 "라이트 핑크" -> #FFB6C1, "가을느낌/단풍색" -> #A0522D, "민트 그린" -> #98FF98
                                 절대 "Light Peach", "Terracotta" 같은 색상 이름 문자열을 value로 쓰지 마세요.
                     - motif: 장식/모티프. 예: "플라워/꽃무늬" -> floral pattern, "리본" -> ribbon, "고양이" -> cat
           \s
                     [season 카테고리 - 계절 또는 TPO(테마/이벤트/상황), 자유롭게 작성 가능]
                     season도 정해진 목록이 없습니다. 계절이든 특정 테마/이벤트/상황이든, 사용자가 표현한
                     의미를 살린 자연스러운 영어 단어로 직접 만들어서 저장하세요.
                     예: "봄 느낌" -> spring, "크리스마스 느낌" -> christmas, "발렌타인 느낌" -> valentine,
                         "생일 파티 느낌" -> birthday, "신년 느낌" -> new-year
                     - "상관없다", "계절감 필요 없다" 같은 표현은 season: none으로 저장하세요.
                     - season은 liked에 최대 2개까지 담을 수 있습니다.
           \s
                     [손가락별 지정 - fingerOverrides]
                     사용자가 "엄지는 A, 나머지는 B"처럼 특정 손가락에 특정 디자인을 지정하면,
                     그 내용을 slotActions와는 별도로 "fingerOverrides"에 담으세요.
                     손가락 키는 thumb, index, middle, ring, pinky만 사용합니다.
                     값은 "category:value" 문자열로 작성하세요 (예: "designType:french tip").
                     예시: "엄지만 프렌치, 나머지는 자석네일로 해줘"
                     -> "fingerOverrides": {
                          "thumb": "designType:french tip",
                          "index": "designType:magnetic",
                          "middle": "designType:magnetic",
                          "ring": "designType:magnetic",
                          "pinky": "designType:magnetic"
                        }
                     손가락별 지정이 없으면 fingerOverrides를 빈 객체 {}로 두세요.
                     
                     [손가락별 비선호 - fingerDislikes]
                      사용자가 "엄지에는 리본 넣지 마세요"처럼 특정 손가락에 대해 피해야 할 것을
                      말하면, slotActions와는 별도로 "fingerDislikes"에 담으세요.
                      손가락 키는 thumb, index, middle, ring, pinky만 사용합니다.
                      값은 그 손가락에서 피해야 할 요소들의 영어 배열입니다.
                      예시: "엄지에는 리본 넣지 마세요" -> "fingerDislikes": { "thumb": ["ribbon"] }
                      손가락별 비선호가 없으면 fingerDislikes를 빈 객체 {}로 두세요.
            \s
                     [옵션 색상 정보 - optionColors]
                     nextQuestionTarget이 "color"일 때는, options 각 항목이 어떤 색을 의미하는지
                     optionColors에 함께 담으세요. 키는 options 배열의 라벨과 정확히 똑같은 문자열이어야 하고,
                     값은 그 옵션이 담고 있는 대표 색상들의 hex 배열입니다 (1~3개 정도).
                     예: "비비드하고 쨍한 컬러" -> ["#FF3B3B", "#FFD400"]
                         "블랙 앤 화이트 조합" -> ["#000000", "#FFFFFF"]
                     color 질문이 아니라면 optionColors는 빈 객체 {}로 두세요.
                   \s
                     [중요]
                     - 확신이 안 서면 억지로 추측해서 반영하지 말고, reply에서 선택지를 주며 되물어보세요.
                     - 부정적 표현("~는 싫어요", "~빼고")은 add_dislike 또는 remove_like로 처리하세요.
                     - 이미 선호했던 걸 취소하고 다른 걸 원하면: remove_like(기존값) + add_like(새값)
                     - liked/disliked에 같은 값이 동시에 있으면 안 됩니다(add_like 시 자동으로 disliked에서 제거됨).
                     - reply에서 "모든 준비가 완료되었습니다", "다 됐어요" 같은 완료를 암시하는
                        문구를 쓴다면, 반드시 isComplete를 true로 설정하세요. reply의 내용과
                        isComplete 값이 서로 모순되면 안 됩니다.
                     - motif를 물어볼 때는 optionColors를 비워두세요 — 색상은 color 카테고리에서만 별도로 물어봅니다.
            \s
                     [현재까지 파악된 선호/비선호 상태]
                     %s
            \s
                     [아직 안 채워진 필수 카테고리]
                     %s
            \s
                     mood, designType, color, season, motif 이 6개 카테고리가 모두 채워져야 완료됩니다.
                     (motif는 "없음"을 원하면 motif: none으로 채워도 완료로 인정합니다.)
                     아직 안 채워진 카테고리 중 하나를 자연스럽게 물어보고, 모두 채워지면 isComplete를 true로
                     설정하세요. 사용자가 망설이는 것 같으면, 이미 파악된 선호를 참고해 짧은 추천 문구를
                     reply에 포함하세요.
            \s
                     반드시 아래 JSON 형식으로만 응답하세요. 마크다운 없이 순수 JSON만 반환합니다.
                     {
                         "reply": "사용자에게 보여줄 한국어 응답",
                         "slotActions": [
                             {"category": "mood", "action": "add_like", "value": "modern"}
                         ],
                         "fingerOverrides": {},
                         "fingerDislikes": {},
                         "nextQuestionTarget": "color",
                         "showOptions": true,
                         "options": ["옵션1(한국어)", "옵션2(한국어)"],
                         "optionColors": {},
                         "isComplete": false
                     }
           \s""";

    @Transactional
    public DesignSession createSession(User user) {
        DesignSession session = DesignSession.builder()
                .user(user)
                .handScan(null)
                .build();
        return designSessionRepository.save(session);
    }

    public ChatResponseDto chat(User user, Long sessionId, String userMessage) {
        DesignSession session = designSessionRepository.findByIdAndUserId(sessionId, user.getId()) //다른 사람이 해당 세션에 접근 못하게
                .orElseThrow(() -> new IllegalArgumentException("해당 채팅 세션을 찾을 수 없습니다."));

        Map<String, SlotData> slots = loadSlots(session.getExtractedPreferences()); //ExtractedPreferences(JSON)객체화

        //안 채워진 필수 카테고리 확인
        List<String> emptyRequiredCategories = REQUIRED_FOR_COMPLETION.stream()
                .filter(cat -> !slots.containsKey(cat) || slots.get(cat).getLiked().isEmpty())
                .toList();

        //대화 히스토리 Gemini가 이해하는 형식으로 변환
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

// 이미 완성된 디자인이 있는 세션인지 확인 (사진 기반 생성 포함) — 있다면 처음부터
        // 다시 슬롯을 채우는 대신 "기존 디자인 수정 요청"으로 다루도록 지시를 추가한다.
        String editModeHint = "";
        if (session.getGeneratedPrompt() != null && !session.getGeneratedPrompt().isBlank()) {
            editModeHint =
                    "[중요 - 이미 디자인이 완성된 세션입니다]\n" +
                            "이 세션은 이미 한 번 디자인이 완성됐습니다 (사진 기반 생성이었을 수도 있습니다).\n" +
                            "지금 온 사용자 메시지는 처음부터 새로 취향을 물어보라는 게 아니라, " +
                            "완성된 디자인 중 일부를 바꿔달라는 \"수정 요청\"입니다.\n" +
                            "이미 채워진 슬롯 값은 사용자가 명시적으로 다시 언급하지 않는 한 그대로 유지하세요 " +
                            "(예를 들어 mood/color가 이미 있는데 사용자가 \"좀 더 young한 느낌\"이라고만 말했다면, " +
                            "mood만 갱신하고 color 등 나머지는 그대로 둡니다).\n" +
                            "아직 안 채워진 카테고리를 순서대로 다시 물어보지 마세요. showOptions로 새로운 " +
                            "무드/컬러 추천 목록을 처음부터 다시 제시하지 마세요 — 사용자가 말한 방향에 맞게 " +
                            "관련 슬롯만 add_like/add_dislike로 조정하고, 바뀐 내용을 반영해서 " +
                            "\"네, ~하게 조정할게요! 모든 준비가 완료되었습니다\" 식으로 바로 재생성 확인으로 " +
                            "이어지는 reply를 주고 isComplete를 true로 유지하세요.\n\n";
        }

        String userSeason = slots.containsKey("season") && !slots.get("season").getLiked().isEmpty()
                ? slots.get("season").getLiked().stream()
                .filter(s -> !"none".equals(s))
                .findFirst().orElse(null)
                : null;
        String trendHint = styleTrendService.buildTrendHint(userSeason);
// 스캔 기반 힌트: 컬러/쉐입만 반영 (퍼스널컬러, 추천 쉐입)
        String scanHint = editModeHint +  trendHint + handScanRepository.findTopByUserOrderByScannedAtDesc(user)
                .filter(scan -> scan.getStatus() == HandScan.ScanStatus.MEASURED
                        || scan.getStatus() == HandScan.ScanStatus.GENERATING_STL
                        || scan.getStatus() == HandScan.ScanStatus.COMPLETED)
                .map(scan -> {
                    StringBuilder hint = new StringBuilder();
                    if (scan.getRecommendedShape() != null && !scan.getRecommendedShape().isBlank()) {
                        hint.append("[스캔 기반 추천 쉐입] 이 사용자의 손 스캔 분석 결과 추천 쉐입은 \"")
                                .append(scan.getRecommendedShape())
                                .append("\"입니다. shape를 물어볼 때는 이 값을 options의 첫 번째 항목으로 반드시 포함하고, ")
                                .append("그 라벨 끝에 \"(스캔 결과 추천)\"이라고 표시하세요. ")
                                .append("예: \"almond\"가 추천값이면 options에 \"아몬드 (스캔 결과 추천)\"처럼 만드세요. ")
                                .append("나머지 1~2개는 대화 맥락과 어울리는 다른 쉐입으로 채우세요.\n");
                    }
                    if (scan.getRecommendedColors() != null && !scan.getRecommendedColors().isBlank()) {
                        hint.append("[스캔 기반 퍼스널컬러 팔레트] 이 사용자의 퍼스널컬러 분석 결과 추천 팔레트: ")
                                .append(scan.getRecommendedColors())
                                .append(". color를 물어볼 때는 이 팔레트를 참고해서 후보를 제시하세요.\n");
                    }
                    return hint.toString();
                })
                .orElse("");

        String systemPrompt = String.format(
                SYSTEM_PROMPT_TEMPLATE, scanHint, slotsJson, String.join(", ", emptyRequiredCategories));

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("contents", contents);
        requestBody.put("systemInstruction", Map.of("parts", List.of(Map.of("text", systemPrompt))));

        //Gemini에게 무조건 JSON으로 응답하도록 강제하는 설정
        //응답이 중간에 잘리지 않도록 출력 토큰을 넉넉히 확보하고, 간단한 대화라 thinking 예산은 낮춤
        requestBody.put("generationConfig", Map.of(
                "responseMimeType", "application/json",
                "maxOutputTokens", 8192,
                "thinkingConfig", Map.of("thinkingLevel", "LOW")
        ));

        // ↓↓↓ 여기서부터 DB 트랜잭션 없이 Gemini 호출 (재시도로 최대 9초+ 걸릴 수 있는 블로킹 구간)
        JsonNode responseNode = callGeminiWithRetry(requestBody);
        //토큰 확인용
        System.out.println("finishReason: " + responseNode.path("candidates").get(0).path("finishReason").asText());
        System.out.println("usageMetadata: " + responseNode.path("usageMetadata"));

        JsonNode partsNode = responseNode.path("candidates").get(0).path("content").path("parts");
        System.out.println("parts 개수: " + partsNode.size());
        System.out.println("parts 전체: " + partsNode.toString());


        String aiResponseText = "";
        if (responseNode != null && responseNode.has("candidates")) {
            aiResponseText = responseNode.path("candidates").get(0)
                    .path("content").path("parts").get(0)
                    .path("text").asText();

            if (aiResponseText != null && !aiResponseText.trim().isEmpty()) {
                aiResponseText = aiResponseText.trim();
                // 텍스트가 닫는 괄호로 끝나지 않으면 강제로 추가
                if (!aiResponseText.endsWith("}")) {
                    aiResponseText += "\n}";
                }
            }
        }
        // ↑↑↑ 여기까지 트랜잭션 없음. 이제부터 결과 반영은 짧은 트랜잭션(persistChatResult)으로 넘김

        return persistChatResult(sessionId, user, userMessage, slots, aiResponseText);
    }

    /**
     * Gemini 응답을 파싱해서 슬롯/세션 상태에 반영하고 채팅 메시지 2건(user, assistant)을 저장한다.
     * 외부 API 호출이 끝난 뒤에만 호출되므로, DB 커넥션을 오래 붙잡지 않는다.
     */
    @Transactional
    protected ChatResponseDto persistChatResult(
            Long sessionId, User user, String userMessage,
            Map<String, SlotData> slots, String aiResponseText) {

        DesignSession session = designSessionRepository.findByIdAndUserId(sessionId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 채팅 세션을 찾을 수 없습니다."));

        String reply;
        String nextQuestionTarget = null;
        boolean showOptions = false;
        List<String> options = new ArrayList<>();
        Map<String, List<String>> optionColors = new HashMap<>();   // 추가
        boolean isComplete = false;

        try {
            JsonNode resultJson = objectMapper.readTree(aiResponseText);
            reply = resultJson.get("reply").asText();

            JsonNode actions = resultJson.get("slotActions");
            if (actions != null && actions.isArray()) {
                applySlotActions(slots, actions);
            }
            if (resultJson.has("fingerOverrides") && resultJson.get("fingerOverrides").size() > 0) {
                session.updateFingerOverrides(resultJson.get("fingerOverrides").toString());
            }
            if (resultJson.has("fingerDislikes") && resultJson.get("fingerDislikes").size() > 0) {
                session.updateFingerDislikes(resultJson.get("fingerDislikes").toString());
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
            if (resultJson.has("optionColors") && resultJson.get("optionColors").isObject()) {
                resultJson.get("optionColors").fields().forEachRemaining(entry -> {
                    List<String> hexes = new ArrayList<>();
                    entry.getValue().forEach(hex -> hexes.add(hex.asText()));
                    optionColors.put(entry.getKey(), hexes);
                });
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
                .optionColors(optionColors)
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

    private static final java.util.regex.Pattern HEX_PATTERN =
            java.util.regex.Pattern.compile("^#?[0-9A-Fa-f]{6}$|^#?[0-9A-Fa-f]{3}$");

    private void applySlotActions(Map<String, SlotData> slots, JsonNode actions) {
        for (JsonNode action : actions) {
            String category = action.get("category").asText();
            String actionType = action.get("action").asText();
            String value = action.get("value").asText();
            // color 카테고리는 반드시 hex 형식만 허용, 아니면 조용히 무시
            if ("color".equals(category) && ("add_like".equals(actionType) || "add_dislike".equals(actionType))) {
                if (!HEX_PATTERN.matcher(value.trim()).matches()) {
                    System.err.println("색상 값이 hex 형식이 아니라 무시함: " + value);
                    continue;
                }
                if (!value.startsWith("#")) {
                    value = "#" + value;
                }
            }

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
                int statusCode = e.getStatusCode().value();
                boolean isRetryable = statusCode == 429 || statusCode == 503; // 429=요청과다, 503=모델 과부하
                boolean hasAttemptsLeft = attempt < maxAttempts;

                System.err.println("Gemini API 호출 실패 (시도 " + attempt + "/" + maxAttempts + "): "
                        + e.getStatusCode() + " " + e.getResponseBodyAsString());

                if (isRetryable && hasAttemptsLeft) {
                    try {
                        Thread.sleep(backoffMillis * attempt); // 1.5초, 3초 ...로 점점 늘려가며 재시도
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