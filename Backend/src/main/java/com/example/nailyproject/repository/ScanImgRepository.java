package com.example.nailyproject.repository;

import com.example.nailyproject.entity.HandScan;
import com.example.nailyproject.entity.ScanImg;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ScanImgRepository extends JpaRepository<ScanImg, Long> {

    // 특정 스캔의 모든 이미지 조회
    List<ScanImg> findByHandScan(HandScan handScan);

    // 특정 스캔의 특정 손가락 이미지 조회
    Optional<ScanImg> findByHandScanAndFinger(HandScan handScan, ScanImg.Finger finger);

    // 특정 스캔의 이미지 개수
    int countByHandScan(HandScan handScan);
}