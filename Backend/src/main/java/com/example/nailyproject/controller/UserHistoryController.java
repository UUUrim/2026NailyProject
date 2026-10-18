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
import com.example.nailyproject.service.ScanService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
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
    private final ScanService scanService;

    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("yyyy. M. d. HH:mm:ss");

    /**
     * 내 손 스캔 전체 이력 조회 GET /users/me/scans
     */
    @GetMapping("/scans")
    public ResponseEntity<ApiResponse<List<ScanHistoryItemDto>>> getMyScans(
            @AuthenticationPrincipal User user) {

        List<HandScan> scans = handScanRepository.findAllByUserOrderByScannedAtDesc(user);

        List<ScanHistoryItemDto> data = scans.stream()
                .filter(scan -> !scan.isHistoryDeleted())
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
     * 분석 결과 화면에 결과가 뜬 뒤 확정된 스캔만 나온다 - 촬영/분석 도중 나간 스캔은 파일이 있어도 빠진다.
     * 사용자가 삭제한 기록도 빠진다.
     */
    @GetMapping("/scan-sessions")
    public ResponseEntity<ApiResponse<List<ScanSessionDto>>> getMyScanSessions(
            @AuthenticationPrincipal User user) {

        ScanService.ScanUsage usage = scanService.scanUsage(user);
        List<ScanSessionDto> data = new ArrayList<>();
        for (ScanResultFileService.SessionSummary s : scanResultFileService.sessions(user.getId())) {
            List<HandScan> hands = handScans(user, s.leftScanId(), s.rightScanId());
            if (!hands.stream().allMatch(HandScan::isResultConfirmed)) continue;
            if (hands.stream().anyMatch(HandScan::isHistoryDeleted)) continue;
            data.add(ScanSessionDto.builder()
                    .key(s.leftScanId() + "-" + s.rightScanId())
                    .leftScanId(s.leftScanId())
                    .rightScanId(s.rightScanId())
                    .scannedAt(s.scannedAt().format(FORMATTER))
                    .status(sessionStatus(hands))
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
                    .deletable(!hands.isEmpty() && !usage.isUsed(s.leftScanId(), s.rightScanId()))
                    .build());
        }

        return ResponseEntity.ok(ApiResponse.success(200, "손 분석 기록 조회 성공.", data));
    }

    /**
     * 손 분석 기록 삭제 DELETE /users/me/scan-sessions/{key}
     * key는 ScanSessionDto.key("{왼손scanId}-{오른손scanId}") 그대로다.
     * 채팅 이력이 없고 그 기록으로 만든 디자인도 남아 있지 않은 기록(ScanSessionDto.deletable)만 지울 수 있다.
     */
    @DeleteMapping("/scan-sessions/{key}")
    public ResponseEntity<ApiResponse<Void>> deleteScanSession(
            @AuthenticationPrincipal User user,
            @PathVariable String key) {

        if (!key.matches("\\d{1,18}-\\d{1,18}")) {
            throw new IllegalArgumentException("해당 손 분석 기록을 찾을 수 없습니다.");
        }
        String[] ids = key.split("-");
        scanService.deleteScanSession(user, Long.parseLong(ids[0]), Long.parseLong(ids[1]));

        return ResponseEntity.ok(ApiResponse.success(200, "손 분석 기록이 삭제되었습니다.", null));
    }

    private static final List<HandScan.ScanStatus> STATUS_ORDER = List.of(
            HandScan.ScanStatus.FAILED, HandScan.ScanStatus.READY, HandScan.ScanStatus.ANALYZING,
            HandScan.ScanStatus.MEASURED, HandScan.ScanStatus.GENERATING_STL, HandScan.ScanStatus.COMPLETED);

    /** 기록 한 줄의 두 손 DB 행 (예전 데이터는 행이 없을 수 있다) */
    private List<HandScan> handScans(User user, long leftId, long rightId) {
        return Stream.of(leftId, rightId)
                .map(id -> handScanRepository.findByIdAndUserId(id, user.getId()))
                .flatMap(Optional::stream)
                .toList();
    }

    /** 두 손의 DB 상태 중 가장 덜 끝난 것. 파일이 있는데 DB 행이 없으면(예전 데이터) MEASURED. */
    private String sessionStatus(List<HandScan> hands) {
        List<HandScan.ScanStatus> statuses = hands.stream()
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
     * 출력 내역 삭제 DELETE /users/me/prints/{orderId}
     * 출력 중인 주문만 빼고 지울 수 있다 (내역에서만 빠지고, 진행 중인 출력이 취소되지는 않는다).
     */
    @DeleteMapping("/prints/{orderId}")
    public ResponseEntity<ApiResponse<Void>> deletePrintOrder(
            @AuthenticationPrincipal User user,
            @PathVariable Long orderId) {

        printOrderService.deletePrintOrder(user, orderId);

        return ResponseEntity.ok(ApiResponse.success(200, "출력 내역이 삭제되었습니다.", null));
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

    //404 - 없는(또는 남의) 기록
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiResponse<Void>> handleNotFound(IllegalArgumentException e) {
        return ResponseEntity
                .status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.fail(404, e.getMessage()));
    }

    //400 - 지금 상태로는 할 수 없는 요청 (예: 진행 중인 출력 삭제)
    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<ApiResponse<Void>> handleIllegalState(IllegalStateException e) {
        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.fail(400, e.getMessage()));
    }
}
