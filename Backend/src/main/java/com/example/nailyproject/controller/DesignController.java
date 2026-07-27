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
import org.springframework.web.multipart.MultipartFile;
import java.util.Base64;

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
     * 디자인 완전 삭제 DELETE /designs/{designId}
     */
    @DeleteMapping("/{designId}")
    public ResponseEntity<ApiResponse<Void>> deleteDesign(
            @AuthenticationPrincipal User user,
            @PathVariable Long designId) {

        nailDesignService.deleteDesign(user, designId);

        return ResponseEntity.ok(
                ApiResponse.success(200, "디자인이 삭제되었습니다.", null)
        );
    }

    /**
     * 상세 디자인 생성 (STEP1~4, ComfyUI 1회 호출 + 파츠 JSON 함께 저장)
     * POST /designs/generate-detailed
     */
    @PostMapping("/generate-detailed")
    public ResponseEntity<ApiResponse<DesignGenerateResponseDto>> generateDetailedDesign(
            @AuthenticationPrincipal User user,
            @RequestBody DesignGenerateRequestDto request) throws Exception {

        DesignGenerateResponseDto data = nailDesignService.generateDetailedDesign(user, request);

        return ResponseEntity
                .status(HttpStatus.ACCEPTED)
                .body(ApiResponse.success(202, "상세 디자인 생성 요청되었습니다.", data));
    }

    /**
     * 참고 이미지 업로드 + 상세 디자인 생성 (사진 기반, 파일탐색기/드래그앤드롭 공통 처리)
     * POST /designs/generate-detailed-from-image (multipart/form-data)
     *   - image: 참고 이미지 파일 (1장)
     *   - sessionId: (선택) 채팅 세션 ID
     *   - scanId: (선택) 손 스캔 ID — 없어도 생성 가능
     */
    @PostMapping(value = "/generate-detailed-from-image", consumes = "multipart/form-data")
    public ResponseEntity<ApiResponse<DesignGenerateResponseDto>> generateDetailedDesignFromImage(
            @AuthenticationPrincipal User user,
            @RequestParam("image") MultipartFile image,
            @RequestParam(value = "sessionId", required = false) Long sessionId,
            @RequestParam(value = "scanId", required = false) Long scanId) throws Exception {

        DesignGenerateRequestDto request = new DesignGenerateRequestDto();
        // sessionId/scanId가 생성자나 setter로 안 들어가면, DTO에 setter 추가 필요
        // (혹은 이 request 대신 아래처럼 서비스 메서드 파라미터를 직접 늘려도 됨)
        request.setSessionId(sessionId);
        request.setScanId(scanId);

        String imageBase64 = Base64.getEncoder().encodeToString(image.getBytes());
        String mimeType = image.getContentType() != null ? image.getContentType() : "image/jpeg";

        DesignGenerateResponseDto data = nailDesignService.generateDetailedDesignFromImage(
                user, request, imageBase64, mimeType);

        return ResponseEntity
                .status(HttpStatus.ACCEPTED)
                .body(ApiResponse.success(202, "사진 기반 상세 디자인 생성 요청되었습니다.", data));
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