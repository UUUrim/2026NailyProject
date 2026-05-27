package com.example.nailyproject.controller;

import com.example.nailyproject.dto.request.UserPreferencesRequestDto;
import com.example.nailyproject.dto.response.ApiResponse;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.service.PreferencesService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/chats")
public class PreferencesController {

    private final PreferencesService preferencesService;

    // 선택지 저장 POST /chats/{sessionId}/preferences
    @PostMapping("/{sessionId}/preferences")
    public ResponseEntity<ApiResponse<Void>> savePreferences(
            @AuthenticationPrincipal User user,
            @PathVariable Long sessionId,
            @RequestBody UserPreferencesRequestDto request) {

        preferencesService.savePreferences(user, sessionId, request);

        return ResponseEntity.ok(
                ApiResponse.success(200, "선택지가 저장되었습니다.", null)
        );
    }

    // 선택지 조회 GET /chats/{sessionId}/preferences
    @GetMapping("/{sessionId}/preferences")
    public ResponseEntity<ApiResponse<UserPreferencesRequestDto>> getPreferences(
            @AuthenticationPrincipal User user,
            @PathVariable Long sessionId) {

        UserPreferencesRequestDto data = preferencesService.getPreferences(user, sessionId);

        return ResponseEntity.ok(
                ApiResponse.success(200, "선택지 조회 성공.", data)
        );
    }

    // 404 세션 없음
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiResponse<Void>> handleNotFound(IllegalArgumentException e) {
        return ResponseEntity.status(404)
                .body(ApiResponse.fail(404, e.getMessage()));
    }
}