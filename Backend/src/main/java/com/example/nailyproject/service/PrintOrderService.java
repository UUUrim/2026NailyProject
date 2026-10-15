package com.example.nailyproject.service;

import com.example.nailyproject.dto.request.PrintOrderRequestDto;
import com.example.nailyproject.dto.response.PrintOrderResponseDto;
import com.example.nailyproject.dto.response.PrinterProgressResponseDto;
import com.example.nailyproject.entity.HandScan;
import com.example.nailyproject.entity.PrintOrder;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.HandScanRepository;
import com.example.nailyproject.repository.PrintOrderRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional
public class PrintOrderService {

    private final PrintOrderRepository printOrderRepository;
    private final HandScanRepository handScanRepository;
    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate = new RestTemplate();

    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("yyyy. M. d. HH:mm");
    private static final List<String> FINGER_ORDER = List.of("thumb", "index", "middle", "ring", "pinky");

    // printer/server.py 주소 — 로컬 PC에서 돌리는 걸 ngrok으로 터널링한 공개 URL을 여기 넣는다.
    // (COMFY_URL, analysis.server.url과 같은 패턴)
    @Value("${printer.server.url}")
    private String printerServerUrl;

    @Value("${server.base.url:http://localhost:8080}") // 백엔드 서버 주소 (콜백 받을 곳)
    private String backendServerUrl;

    /**
     * 사용자가 "네일팁 출력하기"를 눌렀을 때 호출.
     * 주문을 QUEUED로 기록한다. 프론트가 이 직전에 호출한 generateStl()은 "STL 생성을
     * 요청했다"는 응답만 즉시 돌려주고 실제 생성은 파이썬 쪽에서 백그라운드로 계속 진행되는
     * 웹훅 방식이라, 이 시점엔 STL 파일이 아직 로컬에 없는 게 보통이다. 그런데도 여기서 바로
     * 병합(requestMerge)을 시작하면 printer 서버가 아직 없는 STL을 다운로드하려다 대부분
     * "측정 실패로 추정"으로 건너뛰는 레이스 컨디션이 생긴다 — 실제로는 측정 실패가 아니라
     * 그냥 아직 안 끝난 것뿐이었음. 그래서 여기서는 바로 병합을 시작하지 않고, 왼손/오른손
     * 각각의 STL 생성 완료 웹훅(ScanService.receiveStlResult → tryStartMergeForScan)이
     * 도착할 때마다 준비됐는지 확인해서, 필요한 손이 전부 끝났을 때만 병합을 시작한다.
     */
    public PrintOrderResponseDto createPrintOrder(User user, PrintOrderRequestDto request) {
        PrintOrder order = PrintOrder.builder()
                .user(user)
                .shapeId(request.getShapeId())
                .shapeLabelKo(request.getShapeLabelKo())
                .tipExtensionMm(request.getTipExtensionMm())
                .leftScanId(request.getLeftScanId())
                .rightScanId(request.getRightScanId())
                .build();

        PrintOrder saved = printOrderRepository.save(order);

        // 이미 두 손 다 STL 생성이 끝나 있는 드문 경우(예: 재신청)엔 웹훅을 더 기다릴 필요 없이
        // 바로 병합을 시작한다. 보통은 아직 안 끝나 있어서 여기선 QUEUED로 남고,
        // tryStartMergeForScan()이 나중에 병합을 시작시킨다.
        if (isReadyToMerge(saved)) {
            requestMerge(saved);
        } else if (hasStlFailed(saved)) {
            // STL 생성 실패 웹훅이 이 주문이 저장되기도 전에 먼저 도착한 경우 — 기다릴 웹훅이 더
            // 없으니 QUEUED로 영원히 남지 않도록 바로 실패 처리한다.
            failOrder(saved, "네일 팁 STL 생성에 실패했습니다. 다시 신청해 주세요.");
        }

        return toDto(saved);
    }

    /**
     * STL 생성 실패 웹훅(ScanService.receiveStlResult)이 도착했을 때 호출된다. 이 scanId를
     * 기다리던 QUEUED 출력 주문을 실패 처리한다 — 병합을 시작하면 로컬에 남아 있던 예전 STL
     * (사용자가 이번에 고른 길이가 아닌)이 출력될 수 있으므로 절대 진행하지 않는다.
     */
    public void failWaitingOrdersForScan(Long scanId, String reason) {
        List<PrintOrder> waiting = new java.util.ArrayList<>(
                printOrderRepository.findByStatusAndLeftScanId(PrintOrder.PrintStatus.QUEUED, scanId));
        waiting.addAll(printOrderRepository.findByStatusAndRightScanId(PrintOrder.PrintStatus.QUEUED, scanId));

        for (PrintOrder order : waiting) {
            failOrder(order, reason);
        }
    }

    private void failOrder(PrintOrder order, String reason) {
        order.updateStatus(PrintOrder.PrintStatus.FAILED);
        order.updateFailReason(reason);
        printOrderRepository.save(order);
    }

    /**
     * 출력 신청 직전에 프론트가 generateStl()을 호출하므로, 주문이 참조하는 스캔은
     * GENERATING_STL(생성 중) 또는 COMPLETED(생성 완료)여야 정상이다. 그 외(MEASURED 등)라면
     * STL 생성이 이미 실패해서 되돌려진 것이다 (ScanService.receiveStlResult 참고).
     */
    private boolean hasStlFailed(PrintOrder order) {
        return isStlFailedScan(order.getLeftScanId()) || isStlFailedScan(order.getRightScanId());
    }

    private boolean isStlFailedScan(Long scanId) {
        if (scanId == null) return false;
        return handScanRepository.findById(scanId)
                .map(scan -> scan.getStatus() != HandScan.ScanStatus.GENERATING_STL
                        && scan.getStatus() != HandScan.ScanStatus.COMPLETED)
                .orElse(true);
    }

    /**
     * STL 생성 완료 웹훅(ScanService.receiveStlResult)이 scanId 하나에 대해 도착할 때마다
     * 호출된다. 이 scanId를 기다리던 QUEUED 상태 출력 주문이 있는지 찾아서, 그 주문에 필요한
     * 손(왼손/오른손)의 STL이 전부 끝났으면 그제서야 병합을 시작한다.
     */
    // 새 트랜잭션(REQUIRES_NEW)으로 실행한다: 웹훅 두 개(왼손/오른손)가 거의 동시에 도착하면 각자
    // 자기 트랜잭션 안에서 "내 스캔은 COMPLETED, 상대 스캔은 아직 아님"으로만 보여서 둘 다
    // 병합을 시작하지 않는 경쟁 상태가 있었다. 호출하는 쪽(ScanService)이 자기 트랜잭션을 커밋한
    // 뒤에 부르고, 여기서는 최신 커밋 상태를 새로 읽는다.
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void tryStartMergeForScan(Long scanId) {
        List<PrintOrder> waiting = new java.util.ArrayList<>(
                printOrderRepository.findByStatusAndLeftScanId(PrintOrder.PrintStatus.QUEUED, scanId));
        waiting.addAll(printOrderRepository.findByStatusAndRightScanId(PrintOrder.PrintStatus.QUEUED, scanId));

        for (PrintOrder order : waiting) {
            // claimForMerge가 1을 돌려준 쪽만 병합을 시작한다 (두 웹훅이 동시에 준비 완료를 봐도 한 번만)
            if (isReadyToMerge(order) && printOrderRepository.claimForMerge(order.getId()) == 1) {
                requestMerge(order);
            }
        }
    }

    /** 주문이 참조하는 손(들)의 HandScan이 전부 STL 생성까지 끝난(COMPLETED) 상태인지 확인 */
    private boolean isReadyToMerge(PrintOrder order) {
        if (order.getLeftScanId() != null && !isScanStlDone(order.getLeftScanId())) {
            return false;
        }
        if (order.getRightScanId() != null && !isScanStlDone(order.getRightScanId())) {
            return false;
        }
        return order.getLeftScanId() != null || order.getRightScanId() != null;
    }

    private boolean isScanStlDone(Long scanId) {
        return handScanRepository.findById(scanId)
                .map(scan -> scan.getStatus() == HandScan.ScanStatus.COMPLETED)
                .orElse(false);
    }

    /**
     * printer/server.py의 /print/merge-both를 호출한다.
     * 양손 scanId가 둘 다 있어야 하고, 한쪽만 있으면(한 손 출력) 실패 처리한다.
     */
    private void requestMerge(PrintOrder order) {
        order.updateStatus(PrintOrder.PrintStatus.MERGING);
        printOrderRepository.save(order);

        String userid = String.valueOf(order.getUser().getId());
        Map<String, String> shapes = FINGER_ORDER.stream()
                .collect(Collectors.toMap(f -> f, f -> order.getShapeId()));
        String callbackUrl = backendServerUrl + "/prints/" + order.getId() + "/merge-result";
        // 병합 성공 즉시(확인 단계 없이) 슬라이싱+출력까지 자동으로 이어지도록,
        // printer 서버에 "출력 결과 콜백 주소"도 같이 넘긴다.
        String printCallbackUrl = backendServerUrl + "/prints/" + order.getId() + "/print-result";

        // 한 손 출력은 지원하지 않는다 - 병합 결과(양손 3MF)만 S3에 올라가고, 한 손용 병합 엔드포인트는 없다.
        if (order.getLeftScanId() == null || order.getRightScanId() == null) {
            order.updateStatus(PrintOrder.PrintStatus.FAILED);
            order.updateFailReason("네일팁 출력은 양손 스캔이 모두 필요합니다. 양손을 스캔한 뒤 다시 신청해 주세요.");
            printOrderRepository.save(order);
            return;
        }

        try {
            Map<String, Object> requestBody = Map.of(
                    "userid", userid,
                    "leftSession", String.valueOf(order.getLeftScanId()),
                    "rightSession", String.valueOf(order.getRightScanId()),
                    "leftShapes", shapes,
                    "rightShapes", shapes,
                    "callbackUrl", callbackUrl,
                    "printCallbackUrl", printCallbackUrl
            );

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("ngrok-skip-browser-warning", "true");
            HttpEntity<Map<String, Object>> httpEntity = new HttpEntity<>(requestBody, headers);

            restTemplate.exchange(printerServerUrl + "/print/merge-both", HttpMethod.POST, httpEntity, String.class);
        } catch (Exception e) {
            order.updateStatus(PrintOrder.PrintStatus.FAILED);
            order.updateFailReason(describePrinterCallFailure(e, PrinterCallStep.MERGE));
            printOrderRepository.save(order);
        }
    }

    private enum PrinterCallStep {
        MERGE,
        PRINT_START,
    }

    /**
     * printer/server.py 호출 실패의 원인을 사용자가 이해할 수 있는 문구로 변환한다.
     * 원인별로(서버 연결 불가/서버 오류 응답/그 외) 메시지를 나눠서, 원인 불명의 긴 예외
     * 메시지가 그대로 화면에 노출되거나 DB 컬럼 길이를 초과하는 일이 없도록 한다.
     */
    private String describePrinterCallFailure(Exception e, PrinterCallStep step) {
        if (e instanceof ResourceAccessException) {
            return "프린터 서버에 연결할 수 없습니다. 프린터 서버가 켜져 있는지 확인해 주세요.";
        }
        if (e instanceof HttpStatusCodeException) {
            return "프린터 서버가 요청을 처리하지 못했습니다. 다시 시도해 주세요.";
        }
        return switch (step) {
            case MERGE -> "병합 서버 요청에 실패했습니다. 다시 시도해 주세요.";
            case PRINT_START -> "출력 시작 요청에 실패했습니다. 다시 시도해 주세요.";
            default -> "알 수 없는 오류가 발생했습니다.";
        };
    }

    /**
     * printer/server.py의 /print/merge(-both) 콜백 수신.
     * POST /prints/{orderId}/merge-result
     */
    public void receiveMergeResult(Long orderId, JsonNode payload) {
        PrintOrder order = printOrderRepository.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("해당 출력 주문을 찾을 수 없습니다."));

        boolean success = payload.path("success").asBoolean(false);
        if (!success) {
            order.updateStatus(PrintOrder.PrintStatus.FAILED);
            order.updateFailReason(payload.path("message").asText("병합 실패"));
            printOrderRepository.save(order);
            return;
        }

        String mergedModelUrl = payload.path("mergedModelUrl").asText(null);
        order.updateMergedModelUrl(mergedModelUrl);
        // 병합 완료 콜백이 늦게 도착해도, 이미 대기/출력/완료/실패로 넘어간 주문을 MERGED로 되돌리지 않는다.
        PrintOrder.PrintStatus current = order.getStatus();
        if (current == PrintOrder.PrintStatus.QUEUED || current == PrintOrder.PrintStatus.MERGING
                || current == PrintOrder.PrintStatus.MERGED) {
            order.updateStatus(PrintOrder.PrintStatus.MERGED);
        }
        printOrderRepository.save(order);
    }

    /**
     * 사용자가 병합 결과를 확인하고 "진짜 출력하기"를 눌렀을 때 호출.
     * printer/server.py의 /print/start를 호출한다 (슬라이싱 + 프린터 업로드/출력 트리거).
     */
    public PrintOrderResponseDto confirmPrint(User user, Long orderId) {
        PrintOrder order = printOrderRepository.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("해당 출력 주문을 찾을 수 없습니다."));

        if (!order.getUser().getId().equals(user.getId())) {
            throw new IllegalArgumentException("본인의 출력 주문만 진행할 수 있습니다.");
        }
        if (order.getStatus() != PrintOrder.PrintStatus.MERGED) {
            throw new IllegalStateException("아직 병합이 끝나지 않았거나 이미 출력이 시작된 주문입니다.");
        }
        if (order.getMergedModelUrl() == null) {
            throw new IllegalStateException("병합된 모델 URL이 없습니다.");
        }

        String callbackUrl = backendServerUrl + "/prints/" + order.getId() + "/print-result";
        String outputDir = "output/" + order.getUser().getId() + "/" + order.getId();

        Map<String, Object> requestBody = Map.of(
                "mergedModelUrl", order.getMergedModelUrl(),
                "outputDir", outputDir,
                "callbackUrl", callbackUrl
        );

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("ngrok-skip-browser-warning", "true");
            HttpEntity<Map<String, Object>> httpEntity = new HttpEntity<>(requestBody, headers);

            restTemplate.exchange(printerServerUrl + "/print/start", HttpMethod.POST, httpEntity, String.class);
        } catch (Exception e) {
            order.updateStatus(PrintOrder.PrintStatus.FAILED);
            order.updateFailReason(describePrinterCallFailure(e, PrinterCallStep.PRINT_START));
            printOrderRepository.save(order);
            return toDto(order);
        }

        // 주의: 여기서 기존 PRINTING 주문을 COMPLETED로 닫으면 안 된다. 큐 방식에서는
        // 앞 주문이 아직 실제로 출력 중인데 새 주문을 신청할 수 있어서, 출력 중인 주문이
        // 완료로 잘못 바뀐다. 완료/실패는 printer 서버의 /print-result 콜백으로만 반영한다.

        // printer 서버의 /print/start는 큐에 작업을 넣기만 하고 즉시 응답한다 (다른 작업이
        // 출력 중이면 그 뒤에서 대기). 그래서 여기서 바로 PRINTING으로 찍으면, 실제로는 큐에서
        // 기다리고 있을 뿐인데 "출력 중"으로 잘못 보이는 문제. 진짜 출력이 시작됐다는
        // 신호(슬라이싱+프린터 업로드까지 끝남)는 /print-result 콜백(receivePrintResult)으로
        // 따로 오니, 여기서는 "큐에 들어갔다"까지만 반영.
        order.updateStatus(PrintOrder.PrintStatus.WAITING_IN_QUEUE);
        printOrderRepository.save(order);
        return toDto(order);
    }

    /**
     * printer/server.py의 /print/start 콜백 수신.
     * POST /prints/{orderId}/print-result
     */
    public void receivePrintResult(Long orderId, JsonNode payload) {
        PrintOrder order = printOrderRepository.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("해당 출력 주문을 찾을 수 없습니다."));

        boolean success = payload.path("success").asBoolean(false);
        if (!success) {
            order.updateStatus(PrintOrder.PrintStatus.FAILED);
            order.updateFailReason(payload.path("message").asText("출력 시작 실패"));
            printOrderRepository.save(order);
            return;
        }

        String status = payload.path("status").asText("PRINTING");
        if ("WAITING_IN_QUEUE".equals(status)) {
            // printer 서버가 병합 직후 자동 출력 요청을 큐에 넣었다는 신호 — 앞 출력이 끝나고
            // 슬라이싱/업로드가 끝나 PRINTING 콜백이 올 때까지 "프린터 대기 중"으로 둔다.
            // 콜백이 지연돼 PRINTING/완료/실패 콜백보다 늦게 도착하면 상태가 거꾸로 돌아가므로 무시한다.
            PrintOrder.PrintStatus current = order.getStatus();
            if (current == PrintOrder.PrintStatus.PRINTING
                    || current == PrintOrder.PrintStatus.COMPLETED
                    || current == PrintOrder.PrintStatus.FAILED) {
                return;
            }
            order.updateStatus(PrintOrder.PrintStatus.WAITING_IN_QUEUE);
        } else if ("COMPLETED".equals(status)) {
            order.updateStatus(PrintOrder.PrintStatus.COMPLETED);
        } else {
            order.updateStatus(PrintOrder.PrintStatus.PRINTING);
            // 큐 워커는 앞 작업이 끝나야(완료/중단 콜백을 보낸 뒤에야) 다음 작업을 시작한다.
            // 그런데도 다른 주문이 PRINTING으로 남아 있으면 그 콜백이 유실된 것이므로,
            // 화면에 "출력 중"이 두 개 뜨지 않게 정리한다.
            for (PrintOrder stale : printOrderRepository.findByStatusAndIdNot(
                    PrintOrder.PrintStatus.PRINTING, order.getId())) {
                stale.updateStatus(PrintOrder.PrintStatus.COMPLETED);
                printOrderRepository.save(stale);
            }
        }
        printOrderRepository.save(order);
    }

    @Transactional(readOnly = true)
    public List<PrintOrderResponseDto> getMyPrintOrders(User user) {
        return printOrderRepository.findAllByUserOrderByOrderedAtDesc(user).stream()
                .map(this::toDto)
                .collect(Collectors.toList());
    }

    public void completePrintOrder(User user, Long orderId) {
        PrintOrder order = printOrderRepository.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("해당 출력 주문을 찾을 수 없습니다."));
        if (!order.getUser().getId().equals(user.getId())) {
            throw new IllegalArgumentException("본인의 출력 주문만 완료 처리할 수 있습니다.");
        }
        order.updateStatus(PrintOrder.PrintStatus.COMPLETED);
        printOrderRepository.save(order);
    }

    /**
     * 프린터의 실시간 진행 상황 조회 GET /users/me/prints/progress
     * printer/server.py의 GET /print/status를 그대로 대신 호출해서 전달한다.
     * (프론트가 로컬 printer 서버의 ngrok 주소를 직접 알 필요 없이, 항상 백엔드를 통해서만 조회)
     */
    @Transactional(readOnly = true)
    public PrinterProgressResponseDto getPrinterProgress() {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.set("ngrok-skip-browser-warning", "true");
            HttpEntity<Void> httpEntity = new HttpEntity<>(headers);

            var response = restTemplate.exchange(
                    printerServerUrl + "/print/status", HttpMethod.GET, httpEntity, String.class);

            JsonNode body = objectMapper.readTree(response.getBody());

            return PrinterProgressResponseDto.builder()
                    .success(body.path("success").asBoolean(false))
                    .queueSize(body.hasNonNull("queueSize") ? body.get("queueSize").asInt() : 0)
                    .state(body.path("state").asText(null))
                    .percentage(body.hasNonNull("percentage") ? body.get("percentage").asInt() : null)
                    .remainingTimeMin(body.hasNonNull("remainingTimeMin") ? body.get("remainingTimeMin").asInt() : null)
                    .nozzleTemp(body.hasNonNull("nozzleTemp") ? body.get("nozzleTemp").asDouble() : null)
                    .bedTemp(body.hasNonNull("bedTemp") ? body.get("bedTemp").asDouble() : null)
                    .message(body.path("message").asText(null))
                    .build();
        } catch (Exception e) {
            return PrinterProgressResponseDto.builder()
                    .success(false)
                    .message("프린터 서버에 연결할 수 없습니다: " + e.getMessage())
                    .build();
        }
    }

    private PrintOrderResponseDto toDto(PrintOrder order) {
        Integer queueAhead = null;
        // 병합 직후 자동 출력 흐름에서는 MERGED도 "프린터 차례를 기다리는 중"이라 같이 계산한다.
        if (order.getStatus() == PrintOrder.PrintStatus.WAITING_IN_QUEUE
                || order.getStatus() == PrintOrder.PrintStatus.MERGED) {
            queueAhead = (int) printOrderRepository.countByStatusInAndIdLessThan(
                    List.of(PrintOrder.PrintStatus.PRINTING, PrintOrder.PrintStatus.WAITING_IN_QUEUE),
                    order.getId());
        }
        return PrintOrderResponseDto.builder()
                .id(order.getId())
                .shapeId(order.getShapeId())
                .shapeLabelKo(order.getShapeLabelKo())
                .tipExtensionMm(order.getTipExtensionMm())
                .status(order.getStatus().name())
                .orderedAt(order.getOrderedAt() != null ? order.getOrderedAt().format(FORMATTER) : "")
                .leftScanId(order.getLeftScanId())
                .rightScanId(order.getRightScanId())
                .mergedModelUrl(order.getMergedModelUrl())
                .failReason(order.getFailReason())
                .queueAhead(queueAhead)
                .build();
    }
}