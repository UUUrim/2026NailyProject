package com.example.nailyproject.controller;

import com.example.nailyproject.dto.request.RefineRequestDto;
import com.example.nailyproject.dto.response.ApiResponse;
import com.example.nailyproject.dto.response.DesignGenerateResponseDto;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.service.RefineService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/chats")
public class RefineController {

    private final RefineService refineService;

    @PostMapping("/{sessionId}/refine")
    public ResponseEntity<ApiResponse<DesignGenerateResponseDto>> refine(
            @AuthenticationPrincipal User user,
            @PathVariable Long sessionId,
            @Valid @RequestBody RefineRequestDto request) throws Exception {

        DesignGenerateResponseDto result =
                refineService.applyRevision(user, sessionId, request.getMessage());

        return ResponseEntity.ok(
                ApiResponse.success(200, "수정된 디자인이 생성되었습니다.", result)
        );
    }
}