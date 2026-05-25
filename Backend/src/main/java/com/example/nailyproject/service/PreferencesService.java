package com.example.nailyproject.service;

import com.example.nailyproject.dto.request.UserPreferencesRequestDto;
import com.example.nailyproject.entity.DesignSession;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.DesignSessionRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional
@RequiredArgsConstructor
public class PreferencesService {

    private final DesignSessionRepository designSessionRepository;
    private final ObjectMapper objectMapper;

//    선택지 저장 + 프롬프트 생성 POST /chats/{sessionId}/preferences
    public String savePreferences(User user, Long sessionId, UserPreferencesRequestDto request) {

        DesignSession session = designSessionRepository.findByIdAndUserId(sessionId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 채팅 세션을 찾을 수 없습니다."));

        // 선택지 JSON 저장
        try {
            String preferencesJson = objectMapper.writeValueAsString(request);
            session.updateExtractedPreferences(preferencesJson);
        } catch (JsonProcessingException e) {
            throw new RuntimeException("선택지 저장 중 오류가 발생했습니다.");
        }

        // 프롬프트 조합 후 저장
        String prompt = buildPrompt(request);
        session.updateGeneratedPrompt(prompt);

        return prompt;
    }

//    선택지 조회 GET /chats/{sessionId}/preferences
    @Transactional(readOnly = true)
    public UserPreferencesRequestDto getPreferences(User user, Long sessionId) {

        DesignSession session = designSessionRepository.findByIdAndUserId(sessionId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 채팅 세션을 찾을 수 없습니다."));

        String preferencesJson = session.getExtractedPreferences();
        if (preferencesJson == null) return null;

        try {
            return objectMapper.readValue(preferencesJson, UserPreferencesRequestDto.class);
        } catch (JsonProcessingException e) {
            throw new RuntimeException("선택지 조회 중 오류가 발생했습니다.");
        }
    }

//    프롬프트 조합
//    형식: nailart, [shape] nail tips, [design] nail art, [color hex], [mood] mood, [season] season,
//     korean nail art style, product shot, white background, no hands
    private String buildPrompt(UserPreferencesRequestDto request) {
        StringBuilder prompt = new StringBuilder("nailart");

        // shape
        if (request.getShape() != null && !request.getShape().isBlank()) {
            prompt.append(", ").append(request.getShape()).append(" nail tips");
        }

        // designType
        if (request.getDesignType() != null && !request.getDesignType().isEmpty()) {
            prompt.append(", ").append(String.join(" ", request.getDesignType())).append(" nail art");
        }

        // color
        if (request.getColor() != null && !request.getColor().isEmpty()) {
            prompt.append(", ").append(String.join(" ", request.getColor()));
        }

        // mood
        if (request.getMood() != null && !request.getMood().isEmpty()) {
            prompt.append(", ").append(String.join(" ", request.getMood())).append(" mood");
        }

        // season
        if (request.getSeason() != null && !request.getSeason().isBlank()
                && !request.getSeason().equals("상관없음")) {
            prompt.append(", ").append(request.getSeason()).append(" season");
        }

        // motif
        if (request.getMotif() != null && !request.getMotif().isEmpty()
                && !request.getMotif().contains("없음")) {
            prompt.append(", ").append(String.join(" ", request.getMotif()));
        }

        prompt.append(", korean nail art style, product shot, white background, no hands");

        return prompt.toString();
    }
}