package com.example.nailyproject.controller;

import com.example.nailyproject.dto.request.ScanResultRequestDto;
import com.example.nailyproject.dto.request.ScanStartRequestDto;
import com.example.nailyproject.dto.response.ApiResponse;
import com.example.nailyproject.dto.response.ScanResultResponseDto;
import com.example.nailyproject.dto.response.ScanStartResponseDto;
import com.example.nailyproject.entity.ScanImg;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.service.ScanService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.Map;

@RestController
@RequiredArgsConstructor
@RequestMapping("/scans")
public class ScanController {

    private final ScanService scanService;

    /**
     * 스캔 시작 POST /scans
     */
    @PostMapping
    public ResponseEntity<ApiResponse<ScanStartResponseDto>> startScan(
            @AuthenticationPrincipal User user,
            @Valid @RequestBody ScanStartRequestDto request) {

        ScanStartResponseDto data = scanService.startScan(user, request);

        return ResponseEntity
                .status(HttpStatus.CREATED)
                .body(ApiResponse.success(201, "새 스캔이 생성되었습니다.", data));
    }

    /**
     * 손가락 이미지 업로드 POST /scans/{scanId}/images?finger=THUMB
     */
    @PostMapping("/{scanId}/images")
    public ResponseEntity<ApiResponse<Map<String, String>>> uploadFingerImage(
            @AuthenticationPrincipal User user,
            @PathVariable Long scanId,
            @RequestParam("finger") ScanImg.Finger finger,
            @RequestParam("file") MultipartFile file) throws IOException {

        String imageUrl = scanService.uploadFingerImage(user, scanId, finger, file);

        return ResponseEntity.ok(
                ApiResponse.success(200, "이미지가 업로드되었습니다.",
                        Map.of("imageUrl", imageUrl))
        );
    }

    /**
     * 스캔 분석 요청 POST /scans/{scanId}/analyze
     */
    @PostMapping("/{scanId}/analyze")
    public ResponseEntity<ApiResponse<Void>> requestAnalyze(
            @AuthenticationPrincipal User user,
            @PathVariable Long scanId) {

        scanService.requestAnalyze(user, scanId);

        return ResponseEntity.ok(
                ApiResponse.success(200, "분석 요청이 완료되었습니다. 잠시 후 결과를 확인해주세요.", null)
        );
    }

    /**
     * 분석 결과 수신 POST /scans/{scanId}/analyze/result
     * Python 분석 서버가 호출하는 콜백 API
     */
    @PostMapping("/{scanId}/analyze/result")
    public ResponseEntity<ApiResponse<Void>> receiveAnalyzeResult(
            @PathVariable Long scanId,
            @RequestBody ScanResultRequestDto result) {

        scanService.receiveAnalyzeResult(scanId, result);

        return ResponseEntity.ok(
                ApiResponse.success(200, "분석 결과가 저장되었습니다.", null)
        );
    }

    /**
     * 특정 스캔 결과 조회 GET /scans/{scanId}
     * 프론트에서 폴링으로 status 확인
     */
    @GetMapping("/{scanId}")
    public ResponseEntity<ApiResponse<ScanResultResponseDto>> getScanResult(
            @AuthenticationPrincipal User user,
            @PathVariable Long scanId) {

        ScanResultResponseDto data = scanService.getScanResult(user, scanId);

        return ResponseEntity.ok(
                ApiResponse.success(200, "스캔 결과 조회 성공.", data)
        );
    }

    /**
     * 최근 분석 완료된 스캔 조회 GET /scans/latest
     */
    @GetMapping("/latest")
    public ResponseEntity<ApiResponse<ScanResultResponseDto>> getLatestScanResult(
            @AuthenticationPrincipal User user) {

        ScanResultResponseDto data = scanService.getLatestScanResult(user);

        return ResponseEntity.ok(
                ApiResponse.success(200, "최근 스캔 결과 조회 성공.", data)
        );
    }

    /**
     * 400 - 입력값 오류
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidationError(MethodArgumentNotValidException e) {
        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.fail(400, "손 방향 값이 올바르지 않습니다."));
    }

    /**
     * 404 - 스캔 없음
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiResponse<Void>> handleNotFound(IllegalArgumentException e) {
        return ResponseEntity
                .status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.fail(404, e.getMessage()));
    }

    /**
     * 400 - 이미지 부족
     */
    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<ApiResponse<Void>> handleIllegalState(IllegalStateException e) {
        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.fail(400, e.getMessage()));
    }
}