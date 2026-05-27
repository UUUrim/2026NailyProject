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

    /**
     * 선택지 저장 POST /chats/{sessionId}/preferences
     * 프롬프트 생성은 NailDesignService.buildFinalPrompt()에서 처리
     */
    public void savePreferences(User user, Long sessionId, UserPreferencesRequestDto request) {

        DesignSession session = designSessionRepository.findByIdAndUserId(sessionId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 채팅 세션을 찾을 수 없습니다."));

        // 선택지 JSON만 저장
        try {
            String preferencesJson = objectMapper.writeValueAsString(request);
            session.updateExtractedPreferences(preferencesJson);
        } catch (JsonProcessingException e) {
            throw new RuntimeException("선택지 저장 중 오류가 발생했습니다.");
        }
    }

    /**
     * 선택지 조회 GET /chats/{sessionId}/preferences
     */
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
}