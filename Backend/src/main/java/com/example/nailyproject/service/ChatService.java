package com.example.nailyproject.service;

import com.example.nailyproject.entity.*;
import com.example.nailyproject.repository.*;
import com.fasterxml.jackson.core.JsonProcessingException;
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

@Service
@Transactional
@RequiredArgsConstructor
public class ChatService {

    private final HandScanRepository handScanRepository;
    private final DesignSessionRepository designSessionRepository;
    private final ChatMessageRepository chatMessageRepository;
    private final WebClient.Builder webClientBuilder;
    private final ObjectMapper objectMapper; // JSON 파싱을 위해 추가

    @Value("${gemini.api.key}")
    private String apiKey;

    @Value("${gemini.api.url}")
    private String apiUrl;

    //시스템 프롬프트 (JSON 출력 지시)
    private static final String SYSTEM_PROMPT = """
            당신은 Naily 서비스의 네일 디자인 전문 AI 어시스턴트입니다.
            사용자와 자연스럽게 대화하며 네일 취향을 파악하세요.
            사용자가 제공한 정보에 기반하여 어울리는 네일 디자인을 추천해주세요.
            
            [중요 규칙]
            반드시 아래의 JSON 형식으로만 응답해야 합니다. 마크다운(` ```json `)을 포함하지 말고 순수 JSON만 반환하세요.
            {
                "reply": "사용자에게 보여줄 친절한 한국어 챗봇 응답 (추천 및 질문 포함)",
                "preferences": {
                    "color": "파악된 색상이나 HEX 코드 (모르면 null)",
                    "style": "파악된 스타일, 파츠, 패턴 등 (모르면 null)",
                    "mood": "파악된 분위기 (모르면 null)",
                    "season": "파악된 계절감 (모르면 null)"
                }
            }
            """;

    public DesignSession createSession(User user) {
//        HandScan handScan = handScanRepository.findTopByUserOrderByScannedAtDesc(user)
//                .orElseThrow(() -> new IllegalStateException("스캔 내역이 없습니다. 먼저 손 스캔을 진행해주세요."));
//
//        DesignSession session = DesignSession.builder()
//                .user(user)
//                .handScan(handScan)
//                .build();

        //임시 테스트용으로 넣어둔 거
        DesignSession session = DesignSession.builder()
                .user(user)
                .handScan(null) // 스캔 데이터가 없어도 세션 생성 가능하게 함
                .build();


        return designSessionRepository.save(session);
    }

    public String chat(User user, Long sessionId, String userMessage) {

        DesignSession session = designSessionRepository.findByIdAndUserId(sessionId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 채팅 세션을 찾을 수 없습니다."));

        // 기존 채팅 히스토리 로드
        List<ChatMessage> savedMessages = chatMessageRepository.findBySessionOrderBySentAtAsc(session);
        List<Map<String, Object>> contents = new ArrayList<>();

        for (ChatMessage msg : savedMessages) {
            String role = (msg.getRole() == ChatMessage.MessageRole.user) ? "user" : "model";
            contents.add(Map.of(
                    "role", role,
                    "parts", List.of(Map.of("text", msg.getContent()))
            ));
        }

        // 새 메시지 추가
        contents.add(Map.of(
                "role", "user",
                "parts", List.of(Map.of("text", userMessage))
        ));

        // 요청 Body 구성
        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("contents", contents);
        requestBody.put("systemInstruction", Map.of(
                "parts", List.of(Map.of("text", SYSTEM_PROMPT))
        ));

        //Gemini에게 무조건 JSON으로 응답하도록 강제하는 설정
        requestBody.put("generationConfig", Map.of(
                "responseMimeType", "application/json"
        ));

        // WebClient 호출
        WebClient webClient = webClientBuilder.build();
        JsonNode responseNode = webClient.post()
                .uri(apiUrl + "?key=" + apiKey.trim())
                .bodyValue(requestBody)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .block();

        //응답 처리 및 분해
        String aiResponseText = "";
        if (responseNode != null && responseNode.has("candidates")) {
            aiResponseText = responseNode.path("candidates").get(0)
                    .path("content").path("parts").get(0)
                    .path("text").asText();
        }

        String chatReply = "";
        try {
            // Gemini가 준 JSON 문자열을 Java 객체(JsonNode)로 변환
            JsonNode resultJson = objectMapper.readTree(aiResponseText);

            // 프론트엔드(사용자)에게 보여줄 텍스트
            chatReply = resultJson.get("reply").asText();

            // 자체 추천 AI 모델로 넘겨줄 취향 데이터 추출
            JsonNode preferences = resultJson.get("preferences");
            System.out.println("추출된 취향 데이터: " + preferences.toString());
            // TODO: 여기서 preferences 데이터를 세션 DB에 업데이트하거나, 추천 AI 서버로 전송하는 로직을 추가하세요!

        } catch (JsonProcessingException e) {
            e.printStackTrace();
            chatReply = "죄송합니다. 응답을 처리하는 중 오류가 발생했습니다.";
        }

        // DB 저장 (사용자 메시지)
        chatMessageRepository.save(ChatMessage.builder()
                .session(session)
                .role(ChatMessage.MessageRole.user)
                .content(userMessage)
                .build());

        // DB 저장 (AI 응답 - JSON 원본이 아닌 'reply' 텍스트만 저장)
        chatMessageRepository.save(ChatMessage.builder()
                .session(session)
                .role(ChatMessage.MessageRole.assistant)
                .content(chatReply)
                .build());

        // Controller로 챗봇의 답변만 반환
        return chatReply;
    }
}