package com.example.nailyproject.controller;

import com.example.nailyproject.dto.request.PrintOrderRequestDto;
import com.example.nailyproject.dto.response.ApiResponse;
import com.example.nailyproject.dto.response.PrintOrderResponseDto;
import com.example.nailyproject.dto.response.PrinterProgressResponseDto;
import com.example.nailyproject.dto.response.ScanHistoryItemDto;
import com.example.nailyproject.dto.response.ScanSessionDto;
import com.example.nailyproject.entity.HandScan;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.HandScanRepository;
import com.example.nailyproject.service.PrintOrderService;
import com.example.nailyproject.service.ScanResultFileService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Collectors;
import java.util.stream.Stream;

// 마이페이지 '손 분석 결과 이력' / '네일팁 출력 내역' 조회·기록용
@RestController
@RequiredArgsConstructor
@RequestMapping("/users/me")
public class UserHistoryController {

    private final HandScanRepository handScanRepository;
    private final PrintOrderService printOrderService;
    private final ScanResultFileService scanResultFileService;

    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("yyyy. M. d. HH:mm:ss");

    /**
     * 내 손 스캔 전체 이력 조회 GET /users/me/scans
     */
    @GetMapping("/scans")
    public ResponseEntity<ApiResponse<List<ScanHistoryItemDto>>> getMyScans(
            @AuthenticationPrincipal User user) {

        List<HandScan> scans = handScanRepository.findAllByUserOrderByScannedAtDesc(user);

        List<ScanHistoryItemDto> data = scans.stream()
                .map(scan -> {
                    // 분석 값은 로컬 양손 최종 measurements.json에서 온다 (파일이 아직 없으면 비어 있음).
                    ScanResultFileService.ScanAnalysis a = scanResultFileService.analysisFor(scan).orElse(null);
                    return ScanHistoryItemDto.builder()
                            .scanId(scan.getId())
                            .pairedScanId(scan.getPairedScanId())
                            .handSide(scan.getHandSide() != null ? scan.getHandSide().name() : null)
                            .status(scan.getStatus() != null ? scan.getStatus().name() : null)
                            .shape(a != null ? a.recommendedShape() : null)
                            .recommendedShape(a != null ? a.recommendedShape() : null)
                            .skinToneHex(a != null ? a.skinToneHex() : null)
                            .recommendedColors(a != null ? a.recommendedColors() : List.of())
                            .tone(a != null ? a.tone() : null)
                            .warmness(a != null ? a.warmness() : null)
                            .brightness(a != null ? a.brightness() : null)
                            .saturation(a != null ? a.saturation() : null)
                            .avgLengthMm(a != null ? a.avgLengthMm() : null)
                            .avgWidthMm(a != null ? a.avgWidthMm() : null)
                            .avgCurve(a != null ? a.avgCurveMm() : null)
                            .avgFreeEdgeMm(a != null ? a.avgFreeEdgeMm() : null)
                            .scannedAt(scan.getScannedAt() != null ? scan.getScannedAt().format(FORMATTER) : "")
                            .build();
                })
                .collect(Collectors.toList());

        return ResponseEntity.ok(
                ApiResponse.success(200, "손 스캔 이력 조회 성공.", data)
        );
    }

    /**
     * 내 손 분석 기록 목록 GET /users/me/scan-sessions
     * 양손 최종 measurements.json 하나가 한 줄이다. 마이페이지/출력/디자인 채팅이 공통으로 쓴다.
     * (손 한쪽씩의 DB 기록을 시각으로 짝지어 만들지 않는다)
     */
    @GetMapping("/scan-sessions")
    public ResponseEntity<ApiResponse<List<ScanSessionDto>>> getMyScanSessions(
            @AuthenticationPrincipal User user) {

        List<ScanSessionDto> data = scanResultFileService.sessions(user.getId()).stream()
                .map(s -> ScanSessionDto.builder()
                        .key(s.leftScanId() + "-" + s.rightScanId())
                        .leftScanId(s.leftScanId())
                        .rightScanId(s.rightScanId())
                        .scannedAt(s.scannedAt().format(FORMATTER))
                        .status(sessionStatus(user, s.leftScanId(), s.rightScanId()))
                        .shape(s.recommendedShape())
                        .recommendedShape(s.recommendedShape())
                        .skinToneHex(s.skinToneHex())
                        .recommendedColors(s.recommendedColors())
                        .tone(s.tone())
                        .warmness(s.warmness())
                        .brightness(s.brightness())
                        .saturation(s.saturation())
                        .avgLengthMm(s.avgLengthMm())
                        .avgWidthMm(s.avgWidthMm())
                        .avgCurve(s.avgCurveMm())
                        .avgFreeEdgeMm(s.avgFreeEdgeMm())
                        .build())
                .collect(Collectors.toList());

        return ResponseEntity.ok(ApiResponse.success(200, "손 분석 기록 조회 성공.", data));
    }

    private static final List<HandScan.ScanStatus> STATUS_ORDER = List.of(
            HandScan.ScanStatus.FAILED, HandScan.ScanStatus.READY, HandScan.ScanStatus.ANALYZING,
            HandScan.ScanStatus.MEASURED, HandScan.ScanStatus.GENERATING_STL, HandScan.ScanStatus.COMPLETED);

    /** 두 손의 DB 상태 중 가장 덜 끝난 것. 파일이 있는데 DB 행이 없으면(예전 데이터) MEASURED. */
    private String sessionStatus(User user, long leftId, long rightId) {
        List<HandScan.ScanStatus> statuses = Stream.of(leftId, rightId)
                .map(id -> handScanRepository.findByIdAndUserId(id, user.getId()))
                .flatMap(Optional::stream)
                .map(HandScan::getStatus)
                .filter(Objects::nonNull)
                .toList();
        for (HandScan.ScanStatus s : STATUS_ORDER) {
            if (statuses.contains(s)) return s.name();
        }
        return HandScan.ScanStatus.MEASURED.name();
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

    /**
     * 프린터 실시간 진행 상황 조회 GET /users/me/prints/progress
     * printer/server.py의 /print/status를 백엔드가 대신 호출해서 전달한다.
     * 프론트는 출력 중일 때 몇 초 간격으로 이걸 폴링해서 진행률/온도를 보여준다.
     */
    @GetMapping("/prints/progress")
    public ResponseEntity<ApiResponse<PrinterProgressResponseDto>> getPrinterProgress(
            @AuthenticationPrincipal User user) {

        PrinterProgressResponseDto data = printOrderService.getPrinterProgress();

        return ResponseEntity.ok(
                ApiResponse.success(200, "프린터 진행 상황 조회 성공.", data)
        );
    }
}