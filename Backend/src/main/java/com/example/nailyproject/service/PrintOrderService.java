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
import java.util.HashMap;
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
    // 출력하는 손가락: 왼손 검지 하나로 고정 (병합할 STL은 이 손가락의 것만 쓴다)
    private static final String PRINT_FINGER = "index";
    private static final String CANCELED_MESSAGE = "사용자가 출력을 취소했습니다.";

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
     * 왼손 검지 하나만 출력하므로 왼손 scanId만 있으면 된다 (없으면 실패 처리).
     */
    private void requestMerge(PrintOrder order) {
        order.updateStatus(PrintOrder.PrintStatus.MERGING);
        printOrderRepository.save(order);

        String userid = String.valueOf(order.getUser().getId());
        Map<String, String> shapes = Map.of(PRINT_FINGER, order.getShapeId());
        String callbackUrl = backendServerUrl + "/prints/" + order.getId() + "/merge-result";
        // 병합 성공 즉시(확인 단계 없이) 슬라이싱+출력까지 자동으로 이어지도록,
        // printer 서버에 "출력 결과 콜백 주소"도 같이 넘긴다.
        String printCallbackUrl = backendServerUrl + "/prints/" + order.getId() + "/print-result";

        // 왼손 검지만 출력하므로 왼손 스캔이 있어야 한다 (오른손 스캔은 없어도 된다).
        if (order.getLeftScanId() == null) {
            order.updateStatus(PrintOrder.PrintStatus.FAILED);
            order.updateFailReason("네일 팁 출력은 왼손 스캔이 필요합니다. 왼손을 스캔한 뒤 다시 신청해 주세요.");
            printOrderRepository.save(order);
            return;
        }

        try {
            // 오른손은 출력하지 않으므로 rightSession/rightShapes를 보내지 않는다 (printer 서버가 생략을 허용한다)
            Map<String, Object> requestBody = new HashMap<>(Map.of(
                    "userid", userid,
                    "leftSession", String.valueOf(order.getLeftScanId()),
                    "leftShapes", shapes,
                    "callbackUrl", callbackUrl,
                    "printCallbackUrl", printCallbackUrl
            ));
            // STL은 연장 길이별 폴더에 만들어지므로, 이 주문이 신청한 길이의 폴더를 읽도록 알려 준다
            // (null = 길이 기록 전 예전 주문 → 쉐입 기본 길이로 만든 폴더)
            if (order.getTipExtensionMm() != null) {
                requestBody.put("tipExtensionMm", order.getTipExtensionMm());
            }

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

        // 사용자가 이미 취소한(또는 취소 중인) 주문의 늦은 콜백은 무시한다 (취소가 병합 결과나 실패로 덮이지 않게)
        if (isCancelled(order.getStatus())) {
            return;
        }

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

        // 취소가 끝난 주문의 늦은 콜백(PRINTING/완료/실패 등)은 모두 무시한다 (취소가 완료로 덮이면 안 된다)
        if (order.getStatus() == PrintOrder.PrintStatus.CANCELED) {
            return;
        }

        String status = payload.path("status").asText("PRINTING");
        boolean success = payload.path("success").asBoolean(false);

        // 취소 중(CANCELING)인 주문 - 프린터가 멈추는 중이다.
        //  · 취소 콜백, 실패 콜백(프린터가 멈추며 실패로 보고했거나 상태를 확인하지 못함) -> CANCELED (사용자가 원한 결과)
        //  · 취소 요청이 닿기 전에 이미 끝까지 출력된 경우(COMPLETED) -> 실제로 출력이 끝난 것이라 COMPLETED
        //  · 늦게 도착한 PRINTING / WAITING_IN_QUEUE 콜백 -> 무시 (취소 중인 주문을 출력 중으로 되돌리지 않는다)
        if (order.getStatus() == PrintOrder.PrintStatus.CANCELING) {
            if (success && "COMPLETED".equals(status)) {
                order.updateStatus(PrintOrder.PrintStatus.COMPLETED);
                printOrderRepository.save(order);
            } else if (!success || "CANCELED".equals(status)) {
                markCanceled(order);
            }
            return;
        }

        // printer 서버는 취소를 success=false + status=CANCELED로 알린다. 취소는 실패(FAILED)와 구분해야 해서
        // success 검사보다 먼저 확인한다. 이미 끝난 주문(완료/실패)은 취소로 바꾸지 않는다.
        if ("CANCELED".equals(status)) {
            if (!isFinished(order.getStatus())) {
                markCanceled(order);
            }
            return;
        }

        if (!success) {
            order.updateStatus(PrintOrder.PrintStatus.FAILED);
            order.updateFailReason(payload.path("message").asText("출력 시작 실패"));
            printOrderRepository.save(order);
            return;
        }

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
            // 취소 중이던 주문도 마찬가지다: 다음 작업이 시작됐다면 앞 작업은 이미 멈췄고 취소 콜백만 유실된 것이다.
            for (PrintOrder stale : printOrderRepository.findByStatusAndIdNot(
                    PrintOrder.PrintStatus.CANCELING, order.getId())) {
                markCanceled(stale);
            }
        }
        printOrderRepository.save(order);
    }

    @Transactional(readOnly = true)
    public List<PrintOrderResponseDto> getMyPrintOrders(User user) {
        return printOrderRepository.findAllByUserOrderByOrderedAtDesc(user).stream()
                .filter(order -> !order.isHistoryDeleted())
                .map(this::toDto)
                .collect(Collectors.toList());
    }

    /**
     * 출력 내역 삭제 DELETE /users/me/prints/{orderId}
     * 끝난 주문(완료/실패/취소)만 지울 수 있다. 내역에서만 빠지고 행은 남는다.
     * 진행 중인 주문은 지워도 내역에서만 숨겨질 뿐 병합/출력이 그대로 이어지므로, 먼저 출력을 취소하게 한다.
     */
    public void deletePrintOrder(User user, Long orderId) {
        PrintOrder order = printOrderRepository.findById(orderId)
                .filter(o -> o.getUser().getId().equals(user.getId()) && !o.isHistoryDeleted())
                .orElseThrow(() -> new IllegalArgumentException("해당 출력 내역을 찾을 수 없습니다."));
        if (order.getStatus() == PrintOrder.PrintStatus.CANCELING) {
            throw new IllegalStateException("취소가 진행 중입니다. 프린터가 멈추면 삭제할 수 있습니다.");
        }
        if (!isFinished(order.getStatus())) {
            throw new IllegalStateException("진행 중인 출력은 삭제할 수 없습니다. 먼저 출력을 취소해 주세요.");
        }
        order.deleteHistory();
    }

    private static boolean isFinished(PrintOrder.PrintStatus status) {
        return status == PrintOrder.PrintStatus.COMPLETED
                || status == PrintOrder.PrintStatus.FAILED
                || status == PrintOrder.PrintStatus.CANCELED;
    }

    // 취소 중이거나 취소가 끝난 주문
    private static boolean isCancelled(PrintOrder.PrintStatus status) {
        return status == PrintOrder.PrintStatus.CANCELING || status == PrintOrder.PrintStatus.CANCELED;
    }

    private void markCanceled(PrintOrder order) {
        order.updateStatus(PrintOrder.PrintStatus.CANCELED);
        order.updateFailReason(CANCELED_MESSAGE);
        printOrderRepository.save(order);
    }

    private PrintOrder findOwnedOrder(User user, Long orderId, String notOwnerMessage) {
        PrintOrder order = printOrderRepository.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("해당 출력 주문을 찾을 수 없습니다."));
        if (!order.getUser().getId().equals(user.getId())) {
            throw new IllegalArgumentException(notOwnerMessage);
        }
        return order;
    }

    /**
     * 출력 취소 POST /users/me/prints/{orderId}/cancel
     *  - QUEUED(STL 생성을 기다리는 중): printer 서버에 아직 아무것도 시키지 않았으므로 바로 취소한다.
     *  - MERGING/MERGED/WAITING_IN_QUEUE/PRINTING: printer 서버에 취소를 요청한다.
     *      · 대기 중이거나 병합 중이던 주문 -> 바로 취소된다.
     *      · 프린터가 출력 중인 주문 -> 정지 명령을 보내고 CANCELING(취소 중)이 된다. 프린터가 멈추면
     *        printer 서버가 보내는 취소 콜백(receivePrintResult)으로 CANCELED가 된다.
     *        프론트는 CANCELING인 동안 취소/일시정지/재개 버튼을 막으면 된다.
     *  printer 서버에 연결하지 못하면 상태를 바꾸지 않고 오류를 돌려준다 (프린터는 계속 출력 중일 수 있다).
     */
    public PrintOrderResponseDto cancelPrintOrder(User user, Long orderId) {
        PrintOrder order = findOwnedOrder(user, orderId, "본인의 출력 주문만 취소할 수 있습니다.");
        PrintOrder.PrintStatus current = order.getStatus();
        if (current == PrintOrder.PrintStatus.CANCELING) {
            throw new IllegalStateException("이미 취소를 진행하고 있습니다. 프린터가 멈출 때까지 잠시 기다려 주세요.");
        }
        if (isFinished(current)) {
            throw new IllegalStateException("이미 끝난 주문은 취소할 수 없습니다.");
        }
        if (current == PrintOrder.PrintStatus.QUEUED) {
            markCanceled(order);
            return toDto(order);
        }

        // 병합 중이던 주문은 아직 printer 서버 큐에 없다. preCancel로 "취소됨" 표시를 남겨서
        // 병합이 끝난 뒤 큐에 들어가지 않게 한다.
        boolean preCancel = current == PrintOrder.PrintStatus.MERGING || current == PrintOrder.PrintStatus.MERGED;
        JsonNode result = callPrinterControl("/print/cancel", order, preCancel);
        if ("current".equals(result.path("kind").asText(""))) {
            // 프린터가 출력 중이던 주문: 정지 명령을 보낸 상태 - 멈췄다는 콜백이 올 때까지 "취소 중"
            order.updateStatus(PrintOrder.PrintStatus.CANCELING);
            printOrderRepository.save(order);
        } else {
            markCanceled(order);
        }
        return toDto(order);
    }

    /** 출력 일시정지 POST /users/me/prints/{orderId}/pause - 지금 출력 중(PRINTING)인 주문만 */
    public PrintOrderResponseDto pausePrintOrder(User user, Long orderId) {
        return controlPrinting(user, orderId, "/print/pause");
    }

    /** 일시정지 재개 POST /users/me/prints/{orderId}/resume */
    public PrintOrderResponseDto resumePrintOrder(User user, Long orderId) {
        return controlPrinting(user, orderId, "/print/resume");
    }

    // 일시정지/재개는 주문 상태(PRINTING)를 바꾸지 않는다. 일시정지 여부는 프린터 상태(gcodeState=PAUSE)로 본다.
    private PrintOrderResponseDto controlPrinting(User user, Long orderId, String path) {
        PrintOrder order = findOwnedOrder(user, orderId, "본인의 출력 주문만 조작할 수 있습니다.");
        if (order.getStatus() != PrintOrder.PrintStatus.PRINTING) {
            throw new IllegalStateException("출력 중인 주문만 일시정지하거나 재개할 수 있습니다.");
        }
        callPrinterControl(path, order, false);
        return toDto(order);
    }

    /**
     * printer/server.py의 /print/pause, /print/resume, /print/cancel 호출.
     * printer 서버는 항상 200으로 답하고 성공 여부를 success로 알린다. 실패하면 사용자에게 보일 문구로
     * IllegalStateException을 던진다.
     */
    private JsonNode callPrinterControl(String path, PrintOrder order, boolean preCancel) {
        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("orderId", order.getId());
        if (preCancel) {
            requestBody.put("preCancel", true);
        }
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("ngrok-skip-browser-warning", "true");
            var response = restTemplate.exchange(printerServerUrl + path, HttpMethod.POST,
                    new HttpEntity<>(requestBody, headers), String.class);
            JsonNode body = objectMapper.readTree(response.getBody());
            if (!body.path("success").asBoolean(false)) {
                String message = body.path("message").asText("프린터 서버가 요청을 처리하지 못했습니다.");
                throw new IllegalStateException(message.length() > 200 ? message.substring(0, 200) : message);
            }
            return body;
        } catch (IllegalStateException e) {
            throw e;
        } catch (ResourceAccessException e) {
            throw new IllegalStateException("프린터 서버에 연결할 수 없습니다. 프린터 서버가 켜져 있는지 확인해 주세요.");
        } catch (Exception e) {
            throw new IllegalStateException("프린터 서버가 요청을 처리하지 못했습니다. 다시 시도해 주세요.");
        }
    }

    public void completePrintOrder(User user, Long orderId) {
        PrintOrder order = printOrderRepository.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("해당 출력 주문을 찾을 수 없습니다."));
        if (!order.getUser().getId().equals(user.getId())) {
            throw new IllegalArgumentException("본인의 출력 주문만 완료 처리할 수 있습니다.");
        }
        // 취소된(또는 취소 중인) 주문은 완료로 바꾸지 않는다. 프론트의 진행 상황 위젯이 프린터의 FINISH/진행률 100%를
        // 보고 이 API를 부르는데, 그 때문에 취소한 주문이 완료로 덮이면 안 된다. 오류로 응답하면 위젯이
        // "프린터 상태를 가져오지 못했어요"로 보이므로 오류 없이 상태를 그대로 둔다.
        if (isCancelled(order.getStatus())) {
            return;
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
                    .gcodeState(body.path("gcodeState").asText(null))
                    .currentOrderId(body.hasNonNull("currentOrderId") ? body.get("currentOrderId").asLong() : null)
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
                    List.of(PrintOrder.PrintStatus.PRINTING, PrintOrder.PrintStatus.WAITING_IN_QUEUE,
                            PrintOrder.PrintStatus.CANCELING),
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
