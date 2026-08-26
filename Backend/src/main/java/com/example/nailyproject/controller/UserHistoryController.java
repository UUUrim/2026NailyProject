package com.example.nailyproject.controller;

import com.example.nailyproject.dto.request.PrintOrderRequestDto;
import com.example.nailyproject.dto.response.ApiResponse;
import com.example.nailyproject.dto.response.PrintOrderResponseDto;
import com.example.nailyproject.dto.response.PrinterProgressResponseDto;
import com.example.nailyproject.dto.response.ScanHistoryItemDto;
import com.example.nailyproject.entity.HandScan;
import com.example.nailyproject.entity.ScanImg;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.HandScanRepository;
import com.example.nailyproject.repository.ScanImgRepository;
import com.example.nailyproject.service.PrintOrderService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import java.util.stream.Collectors;

// 마이페이지 '손 분석 결과 이력' / '네일팁 출력 내역' 조회·기록용
@RestController
@RequiredArgsConstructor
@RequestMapping("/users/me")
public class UserHistoryController {

    private final HandScanRepository handScanRepository;
    private final ScanImgRepository scanImgRepository;
    private final PrintOrderService printOrderService;
    private final ObjectMapper objectMapper;

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
                    FingerAverages averages = computeFingerAverages(scan);
                    return ScanHistoryItemDto.builder()
                            .scanId(scan.getId())
                            .handSide(scan.getHandSide() != null ? scan.getHandSide().name() : null)
                            .status(scan.getStatus() != null ? scan.getStatus().name() : null)
                            .shape(scan.getShape())
                            .recommendedShape(scan.getRecommendedShape())
                            .skinToneHex(scan.getSkinToneHex())
                            .tone(scan.getTone())
                            .brightness(scan.getBrightness())
                            .saturation(scan.getSaturation())
                            .avgLengthMm(averages.lengthMm())
                            .avgWidthMm(averages.widthMm())
                            .avgCurve(averages.curve())
                            .scannedAt(scan.getScannedAt() != null ? scan.getScannedAt().format(FORMATTER) : "")
                            .build();
                })
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

    // ── 손가락별 측정값 평균 계산 (마이페이지 손 분석 이력 카드에 표시) ──────────────

    private FingerAverages computeFingerAverages(HandScan scan) {
        List<ScanImg> images = scanImgRepository.findByHandScan(scan);
        double lengthSum = 0;
        double widthSum = 0;
        double curveSum = 0;
        int count = 0;

        for (ScanImg img : images) {
            double[] values = parseMeasurements(img.getMeasurements());
            if (values == null) continue;
            lengthSum += values[0];
            widthSum += values[1];
            curveSum += values[2];
            count++;
        }

        if (count == 0) {
            return new FingerAverages(null, null, null);
        }
        return new FingerAverages(
                round1(lengthSum / count),
                round1(widthSum / count),
                round2(curveSum / count)
        );
    }

    private double[] parseMeasurements(String raw) {
        if (raw == null || raw.isBlank()) return null;
        try {
            JsonNode node = objectMapper.readTree(raw);
            double length = firstNumber(node, "lengthMm", "length");
            double width = firstNumber(node, "widthMm", "width");
            // 실제 스캔 파이프라인(scan/server.py)이 내려주는 곡률 필드명은 cCurveMm이다.
            // cCurve/curve는 과거 목업 데이터 호환용 fallback으로만 남겨둔다.
            double curve = firstNumber(node, "cCurveMm", "cCurve", "curve");
            return new double[]{length, width, curve};
        } catch (Exception ignored) {
            return null;
        }
    }

    private double firstNumber(JsonNode node, String... keys) {
        for (String key : keys) {
            if (node.has(key) && node.get(key).isNumber()) {
                return node.get(key).asDouble();
            }
        }
        return 0;
    }

    private Double round1(double value) {
        return Math.round(value * 10.0) / 10.0;
    }

    private Double round2(double value) {
        return Math.round(value * 100.0) / 100.0;
    }

    private record FingerAverages(Double lengthMm, Double widthMm, Double curve) {}
}