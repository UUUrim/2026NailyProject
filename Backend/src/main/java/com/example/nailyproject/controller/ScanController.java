package com.example.nailyproject.controller;

import com.example.nailyproject.dto.request.ScanResultRequestDto;
import com.example.nailyproject.dto.request.ScanStartRequestDto;
import com.example.nailyproject.dto.request.StlGenerateRequestDto;
import com.example.nailyproject.dto.request.StlResultRequestDto;
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
     * 탑뷰(fileTop)와 측면뷰(fileSide) 두 장을 한 번에 받아 각각 저장합니다.
     */
    @PostMapping("/{scanId}/images")
    public ResponseEntity<ApiResponse<Map<String, String>>> uploadFingerImage(
            @AuthenticationPrincipal User user,
            @PathVariable Long scanId,
            @RequestParam("finger") ScanImg.Finger finger,
            @RequestParam("fileTop") MultipartFile fileTop,
            @RequestParam("fileSide") MultipartFile fileSide) throws IOException {

        Map<String, String> urls = scanService.uploadFingerImages(user, scanId, finger, fileTop, fileSide);

        return ResponseEntity.ok(
                ApiResponse.success(200, "이미지가 업로드되었습니다.", urls)
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
        return ResponseEntity.ok(ApiResponse.success(200, "1단계: 분석 요청이 완료되었습니다.", null));
    }

    @PostMapping("/{scanId}/analyze/result")
    public ResponseEntity<ApiResponse<Void>> receiveAnalyzeResult(
            @PathVariable Long scanId,
            @RequestBody ScanResultRequestDto result) {
        scanService.receiveAnalyzeResult(scanId, result);
        return ResponseEntity.ok(ApiResponse.success(200, "1단계: 분석 결과가 저장되었습니다.", null));
    }


    //  [2단계] STL 생성 파이프라인 (유저가 쉐입 선택 시)

    @PostMapping("/{scanId}/generate-stl")
    public ResponseEntity<ApiResponse<Void>> requestGenerateStl(
            @AuthenticationPrincipal User user,
            @PathVariable Long scanId,
            @Valid @RequestBody StlGenerateRequestDto request) {
        scanService.requestGenerateStl(user, scanId, request);
        return ResponseEntity.ok(ApiResponse.success(200, "2단계: STL 모델 생성을 요청했습니다.", null));
    }

    @PostMapping("/{scanId}/generate-stl/result")
    public ResponseEntity<ApiResponse<Void>> receiveStlResult(
            @PathVariable Long scanId,
            @RequestBody StlResultRequestDto result) {
        scanService.receiveStlResult(scanId, result);
        return ResponseEntity.ok(ApiResponse.success(200, "2단계: STL 파일 생성이 완료되었습니다.", null));
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
     * 400 - 필수 파일(파트) 누락
     */
    @ExceptionHandler(org.springframework.web.multipart.support.MissingServletRequestPartException.class)
    public ResponseEntity<ApiResponse<Void>> handleMissingPart(
            org.springframework.web.multipart.support.MissingServletRequestPartException e) {
        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.fail(400, "필수 파일이 누락되었습니다: " + e.getRequestPartName()));
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