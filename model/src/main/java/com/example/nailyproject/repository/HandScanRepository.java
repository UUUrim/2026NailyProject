package com.example.nailyproject.repository;

import com.example.nailyproject.entity.HandScan;
import com.example.nailyproject.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface HandScanRepository extends JpaRepository<HandScan, Long> {
    // 가장 최근 스캔 조회
    Optional<HandScan> findTopByUserOrderByScannedAtDesc(User user);
}
