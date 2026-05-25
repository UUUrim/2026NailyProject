package com.example.nailyproject.controller;

import com.example.nailyproject.dto.request.ScanStartRequestDto;
import com.example.nailyproject.dto.response.ApiResponse;
import com.example.nailyproject.dto.response.ScanStartResponseDto;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.service.ScanService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/scans")
public class ScanController {

    private final ScanService scanService;

    //스캔 시작 POST /scans
    @PostMapping
    public ResponseEntity<ApiResponse<ScanStartResponseDto>> startScan(
            @AuthenticationPrincipal User user,
            @Valid @RequestBody ScanStartRequestDto request) {

        ScanStartResponseDto data = scanService.startScan(user, request);

        return ResponseEntity
                .status(HttpStatus.CREATED) // 201
                .body(ApiResponse.success(201, "새 스캔이 생성되었습니다.", data));
    }

    /**
     * 400 - 입력값 오류 (handSide 없거나 잘못된 값)
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidationError(MethodArgumentNotValidException e) {
        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.fail(400, "손 방향 값이 올바르지 않습니다."));
    }
}