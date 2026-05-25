package com.example.nailyproject.service;

import com.example.nailyproject.dto.request.ScanStartRequestDto;
import com.example.nailyproject.dto.response.ScanStartResponseDto;
import com.example.nailyproject.entity.HandScan;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.HandScanRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional
@RequiredArgsConstructor
public class ScanService {

    private final HandScanRepository handScanRepository;

    //스캔 시작 POST /scans
    public ScanStartResponseDto startScan(User user, ScanStartRequestDto request) {

        HandScan handScan = HandScan.builder()
                .user(user)
                .handSide(request.getHandSide())
                .scanFileUrl("") // 이미지 업로드 전 임시값 (그 null땜시)
                .build();

        HandScan savedScan = handScanRepository.save(handScan);

        return ScanStartResponseDto.builder()
                .scanId(savedScan.getId())
                .build();
    }
}


//Spring Boot 역할    →  스캔 레코드 DB에 생성 (scanId 발급)
//React 역할         →  카메라 권한 요청 + 카메라 화면 표시