package com.example.nailyproject.controller;

import com.example.nailyproject.dto.response.ApiResponse;
import com.example.nailyproject.dto.response.ScanHistoryItemDto;
import com.example.nailyproject.entity.HandScan;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.HandScanRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.stream.Collectors;

// 마이페이지 '손 분석 결과 이력' 목록 조회용
@RestController
@RequiredArgsConstructor
@RequestMapping("/users/me")
public class UserHistoryController {

    private final HandScanRepository handScanRepository;

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
}