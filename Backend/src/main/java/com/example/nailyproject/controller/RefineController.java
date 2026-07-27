package com.example.nailyproject.controller;

import com.example.nailyproject.dto.request.RefineRequestDto;
import com.example.nailyproject.dto.response.ApiResponse;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.service.RefineService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequiredArgsConstructor
@RequestMapping("/chats")
public class RefineController {

    private final RefineService refineService;

    // 자유입력 키워드 추출 POST /chats/{sessionId}/refine
    @PostMapping("/{sessionId}/refine")
    public ResponseEntity<ApiResponse<List<String>>> extractKeywords(
            @AuthenticationPrincipal User user,
            @PathVariable Long sessionId,
            @Valid @RequestBody RefineRequestDto request) {

        // RefineService를 호출해서 Gemini 처리 및 DB 저장
        List<String> keywords = refineService.extractKeywords(user, sessionId, request.getMessage());

        return ResponseEntity.ok(
                ApiResponse.success(200, "키워드 추출 및 저장 성공.", keywords)
        );
    }
}
