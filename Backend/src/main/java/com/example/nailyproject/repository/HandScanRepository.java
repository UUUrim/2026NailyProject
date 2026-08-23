package com.example.nailyproject.repository;

import com.example.nailyproject.entity.HandScan;
import com.example.nailyproject.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface HandScanRepository extends JpaRepository<HandScan, Long> {
    // 가장 최근 스캔 조회
    Optional<HandScan> findTopByUserOrderByScannedAtDesc(User user);

    // scanId가 1번이고 userId가 본인 id인 스캔만 조회 (실패시 404)
    Optional<HandScan> findByIdAndUserId(Long id, Long userId);

    //사용자의 스캔 중에서 분석이 완료된(COMPLETED) 것 중 가장 최근 것을 가져오는
    Optional<HandScan> findTopByUserAndStatusOrderByScannedAtDesc(User user, HandScan.ScanStatus status);

    // 사용자의 전체 스캔 이력 (최신순)
    java.util.List<HandScan> findAllByUserOrderByScannedAtDesc(User user);

}