package com.example.nailyproject.controller;

import com.example.nailyproject.dto.request.PrintOrderRequestDto;
import com.example.nailyproject.dto.response.ApiResponse;
import com.example.nailyproject.dto.response.PrintOrderResponseDto;
import com.example.nailyproject.dto.response.ScanHistoryItemDto;
import com.example.nailyproject.entity.HandScan;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.HandScanRepository;
import com.example.nailyproject.service.PrintOrderService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.stream.Collectors;

// 마이페이지 '손 분석 결과 이력' / '네일팁 출력 내역' 조회·기록용
@RestController
@RequiredArgsConstructor
@RequestMapping("/users/me")
public class UserHistoryController {

    private final HandScanRepository handScanRepository;
    private final PrintOrderService printOrderService;

    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("yyyy. M. d.");

    /**
     * 내 손 스캔 전체 이력 조회 GET /users/me/scans
     */
    @GetMapping("/scans")
    public ResponseEntity<ApiResponse<List<ScanHistoryItemDto>>> getMyScans(
            @AuthenticationPrincipal User user) {

        List<HandScan> scans = handScanRepository.findAllByUserOrderByScannedAtDesc(user);

        List<ScanHistoryItemDto> data = scans.stream()
                .map(scan -> ScanHistoryItemDto.builder()
                        .scanId(scan.getId())
                        .handSide(scan.getHandSide() != null ? scan.getHandSide().name() : null)
                        .status(scan.getStatus() != null ? scan.getStatus().name() : null)
                        .shape(scan.getShape())
                        .seasonNameKo(scan.getSeasonNameKo())
                        .scannedAt(scan.getScannedAt() != null ? scan.getScannedAt().format(FORMATTER) : "")
                        .build())
                .collect(Collectors.toList());

        return ResponseEntity.ok(
                ApiResponse.success(200, "손 스캔 이력 조회 성공.", data)
        );
    }

    /**
     * 네일팁 출력 신청 기록 POST /users/me/prints
     * STL 생성 요청이 성공한 뒤 프론트에서 호출해서 "이 사용자가 이 쉐입으로 출력 신청했다"를 기록
     */
    @PostMapping("/prints")
    public ResponseEntity<ApiResponse<PrintOrderResponseDto>> createPrintOrder(
            @AuthenticationPrincipal User user,
            @RequestBody PrintOrderRequestDto request) {

        PrintOrderResponseDto data = printOrderService.createPrintOrder(user, request);

        return ResponseEntity.ok(
                ApiResponse.success(200, "네일팁 출력 신청이 기록되었습니다.", data)
        );
    }

    /**
     * 내 네일팁 출력 내역 전체 조회 GET /users/me/prints
     */
    @GetMapping("/prints")
    public ResponseEntity<ApiResponse<List<PrintOrderResponseDto>>> getMyPrintOrders(
            @AuthenticationPrincipal User user) {

        List<PrintOrderResponseDto> data = printOrderService.getMyPrintOrders(user);

        return ResponseEntity.ok(
                ApiResponse.success(200, "네일팁 출력 내역 조회 성공.", data)
        );
    }

    /**
     * 병합 결과(MERGED 상태) 확인 후 "진짜 출력하기" POST /users/me/prints/{orderId}/confirm
     * 슬라이싱 + 프린터 업로드/출력 시작을 트리거한다.
     */
    @PostMapping("/prints/{orderId}/confirm")
    public ResponseEntity<ApiResponse<PrintOrderResponseDto>> confirmPrint(
            @AuthenticationPrincipal User user,
            @PathVariable Long orderId) {

        PrintOrderResponseDto data = printOrderService.confirmPrint(user, orderId);

        return ResponseEntity.ok(
                ApiResponse.success(200, "출력이 시작되었습니다.", data)
        );
    }
}