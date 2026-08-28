package com.example.nailyproject.repository;

import com.example.nailyproject.entity.PrintOrder;
import com.example.nailyproject.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface PrintOrderRepository extends JpaRepository<PrintOrder, Long> {

    List<PrintOrder> findAllByUserOrderByOrderedAtDesc(User user);

    // STL 생성 완료 웹훅(ScanService.receiveStlResult)이 도착했을 때, 이 scanId를 기다리고
    // 있던(아직 병합을 시작 안 한) 출력 주문을 찾기 위한 용도
    List<PrintOrder> findByStatusAndLeftScanId(PrintOrder.PrintStatus status, Long leftScanId);
    List<PrintOrder> findByStatusAndRightScanId(PrintOrder.PrintStatus status, Long rightScanId);

    @Modifying
    @Query("UPDATE PrintOrder p SET p.status = 'COMPLETED' WHERE p.user = :user AND p.status = 'PRINTING'")
    void completeAllPrintingByUser(@Param("user") User user);
}