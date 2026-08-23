package com.example.nailyproject.service;

import com.example.nailyproject.dto.request.PrintOrderRequestDto;
import com.example.nailyproject.dto.response.PrintOrderResponseDto;
import com.example.nailyproject.dto.response.PrinterProgressResponseDto;
import com.example.nailyproject.entity.PrintOrder;
import com.example.nailyproject.entity.User;
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
     * 주문을 QUEUED로 기록한 뒤, printer/server.py에 병합 요청을 비동기로 날린다.
     */
    public PrintOrderResponseDto createPrintOrder(User user, PrintOrderRequestDto request) {
        PrintOrder order = PrintOrder.builder()
                .user(user)
                .shapeId(request.getShapeId())
                .shapeLabelKo(request.getShapeLabelKo())
                .leftScanId(request.getLeftScanId())
                .rightScanId(request.getRightScanId())
                .build();

        PrintOrder saved = printOrderRepository.save(order);

        // 병합 요청은 시간이 좀 걸리는 작업이라(STL 다운로드 + trimesh 병합),
        // 응답을 기다리지 않고 바로 반환한다 — printer 서버가 끝나면 콜백으로 알려준다.
        requestMerge(saved);

        return toDto(saved);
    }

    /**
     * printer/server.py의 /print/merge 또는 /print/merge-both를 호출한다.
     * 양손 scanId가 둘 다 있으면 merge-both, 한쪽만 있으면 merge(한 손)로 나눠서 보낸다.
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

        Map<String, Object> requestBody;
        String endpoint;

        boolean hasLeft = order.getLeftScanId() != null;
        boolean hasRight = order.getRightScanId() != null;

        try {
            if (hasLeft && hasRight) {
                endpoint = "/print/merge-both";
                requestBody = Map.of(
                        "userid", userid,
                        "leftSession", String.valueOf(order.getLeftScanId()),
                        "rightSession", String.valueOf(order.getRightScanId()),
                        "leftShapes", shapes,
                        "rightShapes", shapes,
                        "callbackUrl", callbackUrl,
                        "printCallbackUrl", printCallbackUrl
                );
            } else if (hasLeft || hasRight) {
                endpoint = "/print/merge";
                requestBody = Map.of(
                        "userid", userid,
                        "session", String.valueOf(hasLeft ? order.getLeftScanId() : order.getRightScanId()),
                        "hand", hasLeft ? "left" : "right",
                        "shapes", shapes,
                        "callbackUrl", callbackUrl,
                        "printCallbackUrl", printCallbackUrl
                );
            } else {
                order.updateStatus(PrintOrder.PrintStatus.FAILED);
                order.updateFailReason("연결된 손 스캔 정보가 없어 출력할 STL을 찾을 수 없습니다.");
                printOrderRepository.save(order);
                return;
            }

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("ngrok-skip-browser-warning", "true");
            HttpEntity<Map<String, Object>> httpEntity = new HttpEntity<>(requestBody, headers);

            restTemplate.exchange(printerServerUrl + endpoint, HttpMethod.POST, httpEntity, String.class);
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
        order.updateStatus(PrintOrder.PrintStatus.MERGED);
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

        // 실제 PRINTING 전환은 /print-result 콜백에서 하지만, 사용자 화면엔 "요청은 갔다"는
        // 걸 바로 보여주기 위해 낙관적으로 미리 반영해둔다. 콜백이 실패로 오면 다시 FAILED로 덮어써진다.
        order.updateStatus(PrintOrder.PrintStatus.PRINTING);
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

        // 지금은 "출력 시작됨"까지만 콜백으로 받는다. 실제 출력 완료(COMPLETED) 전환은
        // 프린터 자체의 상태 폴링/웹훅이 붙기 전까지는 수동으로(또는 별도 기능으로) 처리해야 한다.
        order.updateStatus(PrintOrder.PrintStatus.PRINTING);
        printOrderRepository.save(order);
    }

    @Transactional(readOnly = true)
    public List<PrintOrderResponseDto> getMyPrintOrders(User user) {
        return printOrderRepository.findAllByUserOrderByOrderedAtDesc(user).stream()
                .map(this::toDto)
                .collect(Collectors.toList());
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
        return PrintOrderResponseDto.builder()
                .id(order.getId())
                .shapeId(order.getShapeId())
                .shapeLabelKo(order.getShapeLabelKo())
                .status(order.getStatus().name())
                .orderedAt(order.getOrderedAt() != null ? order.getOrderedAt().format(FORMATTER) : "")
                .leftScanId(order.getLeftScanId())
                .rightScanId(order.getRightScanId())
                .mergedModelUrl(order.getMergedModelUrl())
                .failReason(order.getFailReason())
                .build();
    }
}