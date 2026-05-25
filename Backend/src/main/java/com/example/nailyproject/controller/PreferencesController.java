package com.example.nailyproject.controller;

import com.example.nailyproject.dto.request.UserPreferencesRequestDto;
import com.example.nailyproject.dto.response.ApiResponse;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.service.PreferencesService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequiredArgsConstructor
@RequestMapping("/chats")
public class PreferencesController {

    private final PreferencesService preferencesService;

//    선택지 저장 POST /chats/{sessionId}/preferences
    @PostMapping("/{sessionId}/preferences")
    public ResponseEntity<ApiResponse<Map<String, String>>> savePreferences(
            @AuthenticationPrincipal User user,
            @PathVariable Long sessionId,
            @RequestBody UserPreferencesRequestDto request) {

        String prompt = preferencesService.savePreferences(user, sessionId, request);

        return ResponseEntity.ok(
                ApiResponse.success(200, "선택지가 저장되었습니다.",
                        Map.of("generatedPrompt", prompt))
        );
    }

//    선택지 조회 GET /chats/{sessionId}/preferences
    @GetMapping("/{sessionId}/preferences")
    public ResponseEntity<ApiResponse<UserPreferencesRequestDto>> getPreferences(
            @AuthenticationPrincipal User user,
            @PathVariable Long sessionId) {

        UserPreferencesRequestDto data = preferencesService.getPreferences(user, sessionId);

        return ResponseEntity.ok(
                ApiResponse.success(200, "선택지 조회 성공.", data)
        );
    }

    //404 세션 없
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiResponse<Void>> handleNotFound(IllegalArgumentException e) {
        return ResponseEntity.status(404)
                .body(ApiResponse.fail(404, e.getMessage()));
    }
}