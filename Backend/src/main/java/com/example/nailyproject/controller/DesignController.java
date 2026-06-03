package com.example.nailyproject.controller;

import com.example.nailyproject.dto.request.DesignGenerateRequestDto;
import com.example.nailyproject.dto.response.ApiResponse;
import com.example.nailyproject.dto.response.DesignGenerateResponseDto;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.service.NailDesignService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/designs")
public class DesignController {

    private final NailDesignService nailDesignService;

    /**
     * 디자인 생성 요청 POST /designs/generate
     */
    @PostMapping("/generate")
    public ResponseEntity<ApiResponse<DesignGenerateResponseDto>> generateDesign(
            @AuthenticationPrincipal User user,
            @RequestBody DesignGenerateRequestDto request) throws Exception {

        DesignGenerateResponseDto data = nailDesignService.generateDesignFromSession(user, request);

        return ResponseEntity
                .status(HttpStatus.ACCEPTED) // 202
                .body(ApiResponse.success(202, "디자인 생성 요청되었습니다.", data));
    }

    /**
     * 404 - 세션/스캔 없음
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiResponse<Void>> handleNotFound(IllegalArgumentException e) {
        return ResponseEntity
                .status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.fail(404, e.getMessage()));
    }

    /**
     * 500 - 이미지 생성 오류
     */
    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<ApiResponse<Void>> handleRuntimeError(RuntimeException e) {
        return ResponseEntity
                .status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.fail(500, e.getMessage()));
    }
}
