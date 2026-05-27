package com.example.nailyproject.service;

import com.example.nailyproject.dto.request.ScanResultRequestDto;
import com.example.nailyproject.dto.request.ScanStartRequestDto;
import com.example.nailyproject.dto.response.ScanResultResponseDto;
import com.example.nailyproject.dto.response.ScanStartResponseDto;
import com.example.nailyproject.entity.HandScan;
import com.example.nailyproject.entity.ScanImg;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.HandScanRepository;
import com.example.nailyproject.repository.ScanImgRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.reactive.function.client.WebClient;

import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
@Transactional
@RequiredArgsConstructor
public class ScanService {

    private final HandScanRepository handScanRepository;
    private final ScanImgRepository scanImgRepository;
    private final S3Service s3Service;
    private final ObjectMapper objectMapper;
    private final WebClient.Builder webClientBuilder;

    @Value("${analysis.server.url:http://localhost:8000}") //임시 분석 url
    private String analysisServerUrl;

    /**
     * 스캔 시작 POST /scans
     */
    public ScanStartResponseDto startScan(User user, ScanStartRequestDto request) {
        HandScan handScan = HandScan.builder()
                .user(user)
                .handSide(request.getHandSide())
                .build();
        HandScan savedScan = handScanRepository.save(handScan);

        return ScanStartResponseDto.builder()
                .scanId(savedScan.getId())
                .build();
    }

    /**
     * 손가락 이미지 업로드 POST /scans/{scanId}/images?finger=THUMB
     * S3 경로: {userId}/{handSide}/{finger}/image.jpg
     */
    public String uploadFingerImage(User user, Long scanId, ScanImg.Finger finger, MultipartFile file) throws IOException {

        HandScan handScan = handScanRepository.findByIdAndUserId(scanId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 스캔을 찾을 수 없습니다."));

        // S3 업로드
        String imageUrl = s3Service.uploadImage(
                file,
                user.getId(),
                handScan.getHandSide().name().toLowerCase(),
                finger.name().toLowerCase()
        );

        // 기존 이미지 있으면 교체
        scanImgRepository.findByHandScanAndFinger(handScan, finger)
                .ifPresent(existing -> {
                    s3Service.deleteFile(existing.getImageUrl());
                    scanImgRepository.delete(existing);
                });

        // DB 저장
        scanImgRepository.save(ScanImg.builder()
                .handScan(handScan)
                .finger(finger)
                .imageUrl(imageUrl)
                .build());

        return imageUrl;
    }

    /**
     * 스캔 분석 요청 POST /scans/{scanId}/analyze
     * Python 분석 서버로 이미지 URL 전송
     */
    public void requestAnalyze(User user, Long scanId) {

        HandScan handScan = handScanRepository.findByIdAndUserId(scanId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 스캔을 찾을 수 없습니다."));

        // 5개 이미지 업로드됐는지 확인
        List<ScanImg> images = scanImgRepository.findByHandScan(handScan);
        if (images.size() < 5) {
            throw new IllegalStateException("모든 손가락 이미지를 업로드해주세요. (" + images.size() + "/5)");
        }

        // 분석 상태 변경
        handScan.startAnalyzing();

        // Python 분석 서버로 이미지 URL 전송
        Map<String, String> imageUrls = new HashMap<>();
        images.forEach(img -> imageUrls.put(img.getFinger().name(), img.getImageUrl()));

        Map<String, Object> requestBody = Map.of(
                "scanId", scanId,
                "userId", user.getId(),
                "handSide", handScan.getHandSide().name(),
                "imageUrls", imageUrls,
                "callbackUrl", "http://localhost:8080/scans/" + scanId + "/analyze/result"
        );

        // 비동기 요청
        webClientBuilder.build()
                .post()
                .uri(analysisServerUrl + "/analyze")
                .bodyValue(requestBody)
                .retrieve()
                .bodyToMono(Void.class)
                .subscribe();
    }

    /**
     * 분석 결과 수신 POST /scans/{scanId}/analyze/result
     * Python 서버가 분석 완료 후 호출하는 콜백
     */
    public void receiveAnalyzeResult(Long scanId, ScanResultRequestDto result) {

        HandScan handScan = handScanRepository.findById(scanId)
                .orElseThrow(() -> new IllegalArgumentException("해당 스캔을 찾을 수 없습니다."));

        // 추천 색상 JSON 변환
        String recommendedColorsJson = null;
        try {
            recommendedColorsJson = objectMapper.writeValueAsString(result.getRecommendedColors());
        } catch (JsonProcessingException e) {
            throw new RuntimeException("색상 데이터 저장 중 오류가 발생했습니다.");
        }

        // 손분석 결과 저장 (shape은 손가락들의 공통 결과)
        handScan.updateAnalysisResult(
                result.getFingers().get(0).getSize(), // 첫 번째 손가락의 size 분류
                result.getSkinToneHex(),
                recommendedColorsJson
        );

        // 손가락별 결과 저장
        List<ScanImg> images = scanImgRepository.findByHandScan(handScan);
        for (ScanResultRequestDto.FingerResult fingerResult : result.getFingers()) {
            images.stream()
                    .filter(img -> img.getFinger().name().equals(fingerResult.getFinger()))
                    .findFirst()
                    .ifPresent(img -> {
                        try {
                            String measurementsJson = objectMapper.writeValueAsString(fingerResult.getMeasurements());
                            img.updateAnalysisResult(
                                    fingerResult.getAnnotatedImageUrl(),
                                    fingerResult.getStlUrl(),
                                    measurementsJson,
                                    fingerResult.getSize()
                            );
                        } catch (JsonProcessingException e) {
                            throw new RuntimeException("측정 데이터 저장 중 오류가 발생했습니다.");
                        }
                    });
        }
    }

    /**
     * 특정 스캔 결과 조회 GET /scans/{scanId}
     * 프론트에서 폴링으로 status 확인
     */
    @Transactional(readOnly = true)
    public ScanResultResponseDto getScanResult(User user, Long scanId) {

        HandScan handScan = handScanRepository.findByIdAndUserId(scanId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 스캔을 찾을 수 없습니다."));

        List<ScanImg> images = scanImgRepository.findByHandScan(handScan);

        return ScanResultResponseDto.from(handScan, images);
    }

    /**
     * 최근 분석 완료된 스캔 조회 GET /scans/latest
     */
    @Transactional(readOnly = true)
    public ScanResultResponseDto getLatestScanResult(User user) {

        HandScan handScan = handScanRepository
                .findTopByUserAndStatusOrderByScannedAtDesc(user, HandScan.ScanStatus.COMPLETED)
                .orElseThrow(() -> new IllegalArgumentException("완료된 스캔이 없습니다."));

        List<ScanImg> images = scanImgRepository.findByHandScan(handScan);

        return ScanResultResponseDto.from(handScan, images);
    }
}

//Spring Boot 역할    →  스캔 레코드 DB에 생성 (scanId 발급)
//React 역할         →  카메라 권한 요청 + 카메라 화면 표시