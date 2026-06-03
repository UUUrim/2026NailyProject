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
    public String uploadFingerImage(User user, Long scanId, ScanImg.Finger finger, MultipartFile file) throws IOException {
        HandScan handScan = handScanRepository.findByIdAndUserId(scanId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 스캔을 찾을 수 없습니다."));

        // 경로: photos/{userid}/{session}/{hand}/{finger}.jpg
        String s3Key = String.format("photos/%s/%d/%s/%s.jpg",
                user.getId(),
                scanId,
                handScan.getHandSide().name().toLowerCase(),
                finger.name().toLowerCase()
        );

        // s3Service.uploadImage는 이제 단순히 URL 문자열을 반환하는 것이 아니라,
        // 위에서 만든 s3Key 경로에 파일을 업로드하도록 수정되어야 합니다.
        String imageUrl = s3Service.uploadImageWithKey(file, s3Key);

        // DB 저장 (기존 이미지 있으면 교체)
        scanImgRepository.findByHandScanAndFinger(handScan, finger)
                .ifPresent(existing -> {
                    // s3Service.deleteFile(existing.getImageUrl()); // 덮어쓰기 되므로 생략 가능
                    scanImgRepository.delete(existing);
                });

        scanImgRepository.save(ScanImg.builder()
                .handScan(handScan)
                .finger(finger)
                .imageUrl(imageUrl)
                .build());

        return imageUrl;
    }

    /**
     * [3단계] 파이썬 서버로 수치 측정(Measure) 요청
     * POST /scans/{scanId}/measure
     */
    public void requestAnalyze(User user, Long scanId) {
        HandScan handScan = handScanRepository.findByIdAndUserId(scanId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 스캔을 찾을 수 없습니다."));

        // 5장 다 올라왔는지 체크
        List<ScanImg> images = scanImgRepository.findByHandScan(handScan);
        if (images.size() < 5) {
            throw new IllegalStateException("모든 손가락 이미지를 업로드해주세요. (" + images.size() + "/5)");
        }

        handScan.updateStatus(HandScan.ScanStatus.ANALYZING); // 상태: 분석 중

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

        // 파이썬이 웹훅으로 보내준(resultDto) 4개의 데이터를 방금 수정한 엔티티 메서드에 쏙 넣어줍니다.
        handScan.updateAnalysisResult(
                resultDto.getShape(),
                resultDto.getSkinToneHex(),
                resultDto.getRecommendedColors() != null ? resultDto.getRecommendedColors().toString() : null,
                resultDto.getOverallSize() // ✨ 여기서 overallSize가 DB로 들어갑니다!
        );

        // 2. ScanImg (자식들) 업데이트: 각 손가락별 측정 수치와 팁 호수 저장
        for (ScanResultRequestDto.FingerResult fingerResult : resultDto.getFingers()) {
            ScanImg.Finger fingerEnum = ScanImg.Finger.valueOf(fingerResult.getFinger().toUpperCase());
            ScanImg scanImg = scanImgRepository.findByHandScanAndFinger(handScan, fingerEnum)
                    .orElseThrow(() -> new IllegalArgumentException("해당 손가락을 찾을 수 없습니다."));

            try {
                // 손가락별 수치는 JSON 형태로 변환해서 저장
                String measurementsJson = objectMapper.writeValueAsString(fingerResult.getMeasurements());
                scanImg.updateAnalysisResult(measurementsJson, fingerResult.getSize());
            } catch (Exception e) {
                throw new RuntimeException("수치 데이터 JSON 변환 중 오류가 발생했습니다.", e);
            }
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
        for (StlResultRequestDto.StlFingerResult fingerResult : resultDto.getFingers()) {
            ScanImg.Finger fingerEnum = ScanImg.Finger.valueOf(fingerResult.getFinger().toUpperCase());
            ScanImg scanImg = scanImgRepository.findByHandScanAndFinger(handScan, fingerEnum)
                    .orElseThrow(() -> new IllegalArgumentException("해당 손가락을 찾을 수 없습니다."));

            scanImg.updateStlUrl(fingerResult.getStlUrl());
        }

        // 2. 모든 과정이 끝났으므로 최종 상태를 COMPLETED로 변경!
        handScan.updateStatus(HandScan.ScanStatus.COMPLETED);
    }

    /**
     * 특정 스캔 결과 조회 (프론트엔드 화면 표시용)
     */
    public ScanResultResponseDto getScanResult(User user, Long scanId) {
        HandScan handScan = handScanRepository.findByIdAndUserId(scanId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 스캔을 찾을 수 없습니다."));

        List<ScanImg> scanImages = scanImgRepository.findByHandScan(handScan);

        return ScanResultResponseDto.from(handScan, scanImages);
    }

    /**
     * 최근 분석 완료된 스캔 조회
     */
    public ScanResultResponseDto getLatestScanResult(User user) {
        HandScan handScan = handScanRepository.findTopByUserOrderByScannedAtDesc(user)
                .orElseThrow(() -> new IllegalArgumentException("최근 스캔 내역이 없습니다."));

        List<ScanImg> scanImages = scanImgRepository.findByHandScan(handScan);

        return ScanResultResponseDto.from(handScan, scanImages);
    }


}
//Spring Boot 역할    →  스캔 레코드 DB에 생성 (scanId 발급)
//React 역할         →  카메라 권한 요청 + 카메라 화면 표시