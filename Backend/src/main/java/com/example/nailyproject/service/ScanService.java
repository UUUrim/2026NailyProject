package com.example.nailyproject.service;

import com.example.nailyproject.dto.request.ScanResultRequestDto;
import com.example.nailyproject.dto.request.ScanStartRequestDto;
import com.example.nailyproject.dto.request.StlGenerateRequestDto;
import com.example.nailyproject.dto.request.StlResultRequestDto;
import com.example.nailyproject.dto.response.ScanResultResponseDto;
import com.example.nailyproject.dto.response.ScanStartResponseDto;
import com.example.nailyproject.entity.HandScan;
import com.example.nailyproject.entity.ScanImg;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.HandScanRepository;
import com.example.nailyproject.repository.ScanImgRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.reactive.function.client.WebClient;

import com.fasterxml.jackson.core.JsonProcessingException;

import java.io.IOException;
import java.util.List;
import java.util.Map;

@Service
@Transactional
@RequiredArgsConstructor
public class ScanService {

    private final HandScanRepository handScanRepository;
    private final ScanImgRepository scanImgRepository;
    private final S3Service s3Service;
    private final WebClient.Builder webClientBuilder;
    private final com.fasterxml.jackson.databind.ObjectMapper objectMapper;
    private final PrintOrderService printOrderService;

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

        return ScanStartResponseDto.builder()
                .scanId(savedScan.getId())
                .build();
    }

    /**
     * [2단계] 프론트엔드에서 찍은 사진 5장 S3 업로드
     * POST /scans/{scanId}/images?finger=thumb
     */
    public Map<String, String> uploadFingerImages(User user, Long scanId, ScanImg.Finger finger,
                                                  MultipartFile fileTop, MultipartFile fileSide) throws IOException {
        HandScan handScan = handScanRepository.findByIdAndUserId(scanId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 스캔을 찾을 수 없습니다."));

        // 경로: photos/{userid}/{session}/{hand}/{finger}_top.jpg, {finger}_side.jpg
        String basePath = String.format("photos/%s/%d/%s/%s",
                user.getId(),
                scanId,
                handScan.getHandSide().name().toLowerCase(),
                finger.name().toLowerCase()
        );

        String imageUrlTop = s3Service.uploadImageWithKey(fileTop, basePath + "_top.jpg");
        String imageUrlSide = s3Service.uploadImageWithKey(fileSide, basePath + "_side.jpg");

        // DB 저장 (기존 이미지 있으면 교체)
        scanImgRepository.findByHandScanAndFinger(handScan, finger)
                .ifPresent(existing -> scanImgRepository.delete(existing));

        scanImgRepository.save(ScanImg.builder()
                .handScan(handScan)
                .finger(finger)
                .imageUrl(imageUrlTop)
                .imageUrlSide(imageUrlSide)
                .build());

        return Map.of("imageUrlTop", imageUrlTop, "imageUrlSide", imageUrlSide);
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
        Map<String, Object> requestBody = Map.of(
                "userid", String.valueOf(user.getId()),
                "session", String.valueOf(scanId),
                "hand", handScan.getHandSide().name().toLowerCase(),
                // 웹훅으로 결과 받을 주소 전달
                "callbackUrl", backendServerUrl + "/scans/" + scanId + "/analyze/result"
        );

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

        String recommendedColorsJson = null;
        if (resultDto.getRecommendedColors() != null && !resultDto.getRecommendedColors().isEmpty()) {
            try {
                recommendedColorsJson = objectMapper.writeValueAsString(resultDto.getRecommendedColors());
            } catch (JsonProcessingException e) {
                throw new RuntimeException("추천 컬러 JSON 변환 중 오류가 발생했습니다.", e);
            }
        }

        handScan.updateAnalysisResult(
                resultDto.getShape(),
                resultDto.getSkinToneHex(),
                recommendedColorsJson,
                resultDto.getTone(),
                resultDto.getBrightness(),
                resultDto.getSaturation(),
                resultDto.getOverallSize()
        );

        // 2. ScanImg 업데이트 (A안: 스캔 서버가 사진 직접 촬영 → DB에 레코드 없을 수 있음 → 없으면 생성)
        // fingers가 null일 수 있음 — 스캔 서버가 측정 파이프라인 도중 예외를 만나면
        // {"success": false, "message": ...}만 콜백으로 보내는데, 그 응답엔 fingers 자체가
        // 없어서 null로 역직렬화된다. 이 경우도 "0개 성공"으로 취급해서 처리를 계속 진행하고,
        // 아래 상태 분류(FAILED)로 정상 처리되도록 한다.
        if (resultDto.getFingers() != null) {
            for (ScanResultRequestDto.FingerResult fingerResult : resultDto.getFingers()) {
                ScanImg.Finger fingerEnum = ScanImg.Finger.valueOf(fingerResult.getFinger().toUpperCase());
                String annotatedUrl = fingerResult.getAnnotatedImageUrl() != null
                        ? fingerResult.getAnnotatedImageUrl() : "";

                ScanImg scanImg = scanImgRepository.findByHandScanAndFinger(handScan, fingerEnum)
                        .orElseGet(() -> scanImgRepository.save(
                                ScanImg.builder()
                                        .handScan(handScan)
                                        .finger(fingerEnum)
                                        .imageUrl(annotatedUrl)   // annotated 이미지를 대표 이미지로 저장
                                        .build()
                        ));

                try {
                    String measurementsJson = objectMapper.writeValueAsString(fingerResult.getMeasurements());
                    scanImg.updateAnalysisResult(measurementsJson, fingerResult.getSize());
                    // 스캔 서버가 annotated URL을 보내줬으면 imageUrl 업데이트
                    if (!annotatedUrl.isEmpty()) {
                        scanImg.updateImageUrl(annotatedUrl);
                    }
                } catch (Exception e) {
                    throw new RuntimeException("수치 데이터 JSON 변환 중 오류가 발생했습니다.", e);
                }
            }
        }

        // 3. 실제로 측정에 성공한 손가락 수를 기준으로 상태를 명확히 표시한다.
        //    (이전엔 여기서 상태를 아예 안 건드려서, 측정이 5개 다 실패해도 화면에는
        //    "완료"처럼 보이고 프론트가 Mock 값으로 조용히 메꿔버리는 문제가 있었다.)
        int succeededCount = resultDto.getFingers() != null ? resultDto.getFingers().size() : 0;
        if (succeededCount == 0) {
            handScan.updateStatus(HandScan.ScanStatus.FAILED);
        } else if (succeededCount < 5) {
            // 일부만 성공 — 실패로 보긴 애매하지만, 최소한 로그로는 남겨서 나중에 원인 추적 가능하게 함
            System.err.println("[Scan] scanId=" + scanId + " 측정 부분 성공: " + succeededCount + "/5 손가락만 완료됨");
            handScan.updateStatus(HandScan.ScanStatus.MEASURED);
        } else {
            handScan.updateStatus(HandScan.ScanStatus.MEASURED);
        }
    }

    /**
     * [5단계] 2단계 STL 3D 모델 생성 요청 (Front -> Spring Boot -> Python)
     */
    public void requestGenerateStl(User user, Long scanId, StlGenerateRequestDto request) {
        HandScan handScan = handScanRepository.findByIdAndUserId(scanId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 스캔을 찾을 수 없습니다."));

        // 1. 유저가 화면에서 최종 선택한 쉐입으로 DB 덮어쓰기 & 상태 변경
        handScan.updateShape(request.getShape());
        handScan.updateStatus(HandScan.ScanStatus.GENERATING_STL);

        // 2. 파이썬 FastAPI로 보낼 데이터 조합
        Map<String, Object> requestBody = Map.of(
                "userid", String.valueOf(user.getId()),
                "session", String.valueOf(scanId),
                "hand", handScan.getHandSide().name().toLowerCase(),
                "shape", request.getShape(), //유저가 고른 쉐입 정보 전달
                "callbackUrl", backendServerUrl + "/scans/" + scanId + "/generate-stl/result" // 2차 웹훅 주소
        );

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

        // 1. 손가락별로 완성된 STL 파일 S3 주소 업데이트
        // fingers가 null일 수 있음 — 파이썬 쪽 STL 생성 파이프라인이 예외를 만나면
        // {"success": false, "message": ...}만 콜백으로 보내는데 fingers 자체가 없다.
        if (resultDto.getFingers() != null) {
            for (StlResultRequestDto.StlFingerResult fingerResult : resultDto.getFingers()) {
                ScanImg.Finger fingerEnum = ScanImg.Finger.valueOf(fingerResult.getFinger().toUpperCase());
                ScanImg scanImg = scanImgRepository.findByHandScanAndFinger(handScan, fingerEnum)
                        .orElseThrow(() -> new IllegalArgumentException("해당 손가락을 찾을 수 없습니다."));

                scanImg.updateStlUrl(fingerResult.getStlUrl());
            }
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

        List<ScanImg> scanImages = scanImgRepository.findByHandScan(handScan);

        return ScanResultResponseDto.from(handScan, scanImages, objectMapper);
    }

    /**
     * 최근 분석 완료된 스캔 조회
     */
    public ScanResultResponseDto getLatestScanResult(User user) {
        HandScan handScan = handScanRepository.findTopByUserOrderByScannedAtDesc(user)
                .orElseThrow(() -> new IllegalArgumentException("최근 스캔 내역이 없습니다."));

        List<ScanImg> scanImages = scanImgRepository.findByHandScan(handScan);

        return ScanResultResponseDto.from(handScan, scanImages, objectMapper);
    }


}
//Spring Boot 역할    →  스캔 레코드 DB에 생성 (scanId 발급)
//React 역할         →  카메라 권한 요청 + 카메라 화면 표시