package com.example.nailyproject.service;

import com.example.nailyproject.dto.request.ScanResultRequestDto;
import com.example.nailyproject.dto.request.ScanStartRequestDto;
import com.example.nailyproject.dto.request.StlGenerateRequestDto;
import com.example.nailyproject.dto.request.StlResultRequestDto;
import com.example.nailyproject.dto.response.ScanResultResponseDto;
import com.example.nailyproject.dto.response.ScanStartResponseDto;
import com.example.nailyproject.entity.HandScan;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.HandScanRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.HashMap;
import java.util.Map;

@Service
@Transactional
@RequiredArgsConstructor
public class ScanService {

    private final HandScanRepository handScanRepository;
    private final WebClient.Builder webClientBuilder;
    private final PrintOrderService printOrderService;
    private final ScanResultFileService scanResultFileService;

    @Value("${analysis.server.url:http://localhost:8000}")
    private String analysisServerUrl;

    @Value("${server.base.url:http://localhost:8080}") // 백엔드 서버 주소
    private String backendServerUrl;

    /**
     * [1단계] 스캔 시작 (방 만들기)
     * POST /scans
     */
    public ScanStartResponseDto startScan(User user, ScanStartRequestDto request) {
        HandScan handScan = HandScan.builder()
                .user(user)
                .handSide(request.getHandSide())
                .status(HandScan.ScanStatus.READY) // 초기 상태
                .build();
        HandScan savedScan = handScanRepository.save(handScan);

        // 두 번째 손: 같은 스캔의 반대 손과 서로를 짝으로 기록한다.
        Long pairedId = request.getPairedScanId();
        if (pairedId != null) {
            HandScan partner = handScanRepository.findByIdAndUserId(pairedId, user.getId())
                    .orElseThrow(() -> new IllegalArgumentException("짝이 될 스캔을 찾을 수 없습니다."));
            if (partner.getHandSide() == savedScan.getHandSide()) {
                throw new IllegalArgumentException("같은 손끼리는 짝이 될 수 없습니다.");
            }
            if (partner.getPairedScanId() != null) {
                throw new IllegalArgumentException("이미 다른 스캔과 짝지어진 스캔입니다.");
            }
            savedScan.pairWith(partner.getId());
            partner.pairWith(savedScan.getId());
        }

        return ScanStartResponseDto.builder()
                .scanId(savedScan.getId())
                .build();
    }

    /**
     * [3단계] 파이썬 서버로 수치 측정(Measure) 요청
     * POST /scans/{scanId}/measure
     */
    public void requestAnalyze(User user, Long scanId) {
        HandScan handScan = handScanRepository.findByIdAndUserId(scanId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 스캔을 찾을 수 없습니다."));

        // A안: 사진 촬영은 스캔 서버가 직접 담당 → 프론트 업로드 체크 없음
        handScan.updateStatus(HandScan.ScanStatus.ANALYZING);

        // 파이썬 FastAPI로 보낼 데이터 조합
        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("userid", String.valueOf(user.getId()));
        requestBody.put("session", String.valueOf(scanId));
        requestBody.put("hand", handScan.getHandSide().name().toLowerCase());
        // 웹훅으로 결과 받을 주소 전달
        requestBody.put("callbackUrl", backendServerUrl + "/scans/" + scanId + "/analyze/result");
        // 같은 스캔의 반대 손(있으면). 스캔 서버는 이 짝으로만 양손 최종 measurements.json을 만든다.
        if (handScan.getPairedScanId() != null) {
            requestBody.put("pairedSession", String.valueOf(handScan.getPairedScanId()));
        }

        // FastAPI 1번 주소 찌르기 (비동기)
        webClientBuilder.build()
                .post()
                .uri(analysisServerUrl + "/analyze/measure")
                .bodyValue(requestBody)
                .retrieve()
                .bodyToMono(Void.class)
                .subscribe(); // WebClient가 비동기로 쏘고 바로 잊어버림 (웹훅으로 결과 받을 거니까!)
    }

    /**
     * [4단계] 1단계 수치 측정 결과 수신 (웹훅: Python -> Spring Boot)
     * POST /scans/{scanId}/analyze/result
     */
    public void receiveAnalyzeResult(Long scanId, ScanResultRequestDto resultDto) {
        HandScan handScan = handScanRepository.findById(scanId)
                .orElseThrow(() -> new IllegalArgumentException("해당 스캔을 찾을 수 없습니다."));

        // 분석 값(피부톤, 추천 컬러, 치수 등)은 DB에 저장하지 않는다 - 스캔 서버가 만든 로컬
        // 최종 measurements.json을 ScanResultFileService가 읽는다. 여기서는 상태만 갱신한다.
        // 스캔 서버는 측정 파이프라인이 도중에 실패하면 {"success": false, "message": ...}만 보낸다.
        if (resultDto.isFailed()) {
            handScan.updateStatus(HandScan.ScanStatus.FAILED);
            return;
        }

        int measured = resultDto.getMeasuredFingers();
        if (measured < 5) {
            // 일부만 성공 — 실패로 보긴 애매하지만, 최소한 로그로는 남겨서 나중에 원인 추적 가능하게 함
            System.err.println("[Scan] scanId=" + scanId + " 측정 부분 성공: " + measured + "/5 손가락만 완료됨");
        }
        handScan.updateStatus(HandScan.ScanStatus.MEASURED);
    }

    /**
     * [5단계] 2단계 STL 3D 모델 생성 요청 (Front -> Spring Boot -> Python)
     */
    public void requestGenerateStl(User user, Long scanId, StlGenerateRequestDto request) {
        HandScan handScan = handScanRepository.findByIdAndUserId(scanId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 스캔을 찾을 수 없습니다."));

        // 1. 상태 변경 (유저가 고른 쉐입은 출력 주문(print_orders)에 기록되므로 여기엔 저장하지 않는다)
        handScan.updateStatus(HandScan.ScanStatus.GENERATING_STL);

        // 2. 파이썬 FastAPI로 보낼 데이터 조합
        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("userid", String.valueOf(user.getId()));
        requestBody.put("session", String.valueOf(scanId));
        requestBody.put("hand", handScan.getHandSide().name().toLowerCase());
        requestBody.put("shape", request.getShape()); //유저가 고른 쉐입 정보 전달
        requestBody.put("callbackUrl", backendServerUrl + "/scans/" + scanId + "/generate-stl/result"); // 2차 웹훅 주소
        // 유저가 길이 조절 UI에서 커스텀 값을 넣은 경우에만 전달 — 생략 시 파이썬 서버가
        // 쉐입별 기본 연장 길이를 사용한다.
        if (request.getTipExtensionMm() != null) {
            requestBody.put("tip_extension_mm", request.getTipExtensionMm());
        }

        // FastAPI 2번 주소(STL 생성) 찌르기 (비동기)
        webClientBuilder.build()
                .post()
                .uri(analysisServerUrl + "/analyze/stl")
                .bodyValue(requestBody)
                .retrieve()
                .bodyToMono(Void.class)
                .subscribe();
    }

    /**
     * [6단계] 2단계 STL 생성 결과 수신 및 최종 완료 (웹훅: Python -> Spring Boot)
     */
    public void receiveStlResult(Long scanId, StlResultRequestDto resultDto) {
        HandScan handScan = handScanRepository.findById(scanId)
                .orElseThrow(() -> new IllegalArgumentException("해당 스캔을 찾을 수 없습니다."));

        // 0. STL 생성 실패 — 예전엔 실패해도 COMPLETED로 바꾸고 병합을 시작해서, 로컬에 남아 있던
        //    이전 출력 때의 STL(다른 길이/쉐입일 수 있음)이 그대로 출력될 위험이 있었다.
        //    측정값 자체는 멀쩡하므로 스캔은 MEASURED로 되돌리고(분석 결과·디자인 채팅은 계속 사용 가능),
        //    이 스캔을 기다리던 출력 주문만 실패 처리한다.
        if (resultDto.isFailed()) {
            handScan.updateStatus(HandScan.ScanStatus.MEASURED);
            String detail = resultDto.getMessage() != null ? " (" + resultDto.getMessage() + ")" : "";
            printOrderService.failWaitingOrdersForScan(scanId, "네일 팁 STL 생성에 실패했습니다" + detail);
            return;
        }

        // 2. 모든 과정이 끝났으므로 최종 상태를 COMPLETED로 변경!
        handScan.updateStatus(HandScan.ScanStatus.COMPLETED);

        // 3. 이 손의 STL 생성이 방금 끝났으니, 이 scanId를 기다리고 있던 출력 주문이 있으면
        //    (양손 다 필요한 주문이면 나머지 손도 끝났는지 확인 후) 병합을 시작한다.
        printOrderService.tryStartMergeForScan(scanId);
    }

    /**
     * 특정 스캔 결과 조회 (프론트엔드 화면 표시용)
     */
    public ScanResultResponseDto getScanResult(User user, Long scanId) {
        HandScan handScan = handScanRepository.findByIdAndUserId(scanId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 스캔을 찾을 수 없습니다."));

        return withFileAnalysis(handScan, ScanResultResponseDto.from(handScan));
    }

    /**
     * 최근 분석 완료된 스캔 조회
     */
    public ScanResultResponseDto getLatestScanResult(User user) {
        HandScan handScan = handScanRepository.findTopByUserOrderByScannedAtDesc(user)
                .orElseThrow(() -> new IllegalArgumentException("최근 스캔 내역이 없습니다."));

        return withFileAnalysis(handScan, ScanResultResponseDto.from(handScan));
    }

    /**
     * 로컬의 양손 최종 measurements.json이 있으면 분석 값(피부톤/추천 컬러/추천 쉐입/치수)을
     * 그 파일 값으로 채워서 돌려준다. 스캔 상태(status)와 스캔 시각만 DB 값이다.
     * 파일이 아직 없으면(두 손이 안 끝났거나 예전 스캔) 분석 값은 비어 있다.
     */
    private ScanResultResponseDto withFileAnalysis(HandScan handScan, ScanResultResponseDto fromDb) {
        return scanResultFileService.analysisFor(handScan)
                .map(a -> fromDb.toBuilder()
                        .shape(a.recommendedShape())
                        .recommendedShape(a.recommendedShape())
                        .skinToneHex(a.skinToneHex())
                        .recommendedColors(a.recommendedColors())
                        .tone(a.tone())
                        .warmness(a.warmness())
                        .brightness(a.brightness())
                        .saturation(a.saturation())
                        .overallSize(a.overallSize())
                        .fingers(a.fingers().stream()
                                .map(f -> ScanResultResponseDto.FingerResultDto.builder()
                                        .finger(f.finger())
                                        .measurements(f.measurementsJson())
                                        .size(f.size())
                                        .build())
                                .toList())
                        .build())
                .orElse(fromDb);
    }


}
//Spring Boot 역할    →  스캔 레코드 DB에 생성 (scanId 발급)
//React 역할         →  카메라 권한 요청 + 카메라 화면 표시