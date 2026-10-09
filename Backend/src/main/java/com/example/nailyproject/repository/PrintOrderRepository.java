package com.example.nailyproject.repository;

import com.example.nailyproject.entity.PrintOrder;
import com.example.nailyproject.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

public interface PrintOrderRepository extends JpaRepository<PrintOrder, Long> {

    List<PrintOrder> findAllByUserOrderByOrderedAtDesc(User user);

    // STL 생성 완료 웹훅(ScanService.receiveStlResult)이 도착했을 때, 이 scanId를 기다리고
    // 있던(아직 병합을 시작 안 한) 출력 주문을 찾기 위한 용도
    List<PrintOrder> findByStatusAndLeftScanId(PrintOrder.PrintStatus status, Long leftScanId);
    List<PrintOrder> findByStatusAndRightScanId(PrintOrder.PrintStatus status, Long rightScanId);

    // 큐 순번 계산용: 이 주문보다 먼저 들어온(id가 작은) 출력 중/대기 중 주문 수 (모든 사용자 합산)
    long countByStatusInAndIdLessThan(Collection<PrintOrder.PrintStatus> statuses, Long id);

    // 프린터는 한 대고 큐는 한 번에 하나씩만 처리하므로, 새 작업이 PRINTING이 되는 시점에
    // 다른 PRINTING 주문이 남아 있다면 완료/실패 콜백이 유실된 낡은 상태다.
    List<PrintOrder> findByStatusAndIdNot(PrintOrder.PrintStatus status, Long id);

    // QUEUED -> MERGING을 한 번에(원자적으로) 바꾸고, 실제로 바꾼 행 수(0 또는 1)를 돌려준다.
    // 양손 STL 웹훅 두 개가 동시에 병합을 시작하려 해도 한쪽만 1을 받아 병합이 한 번만 시작된다.
    @Modifying
    @Query("UPDATE PrintOrder p SET p.status = 'MERGING' WHERE p.id = :id AND p.status = 'QUEUED'")
    int claimForMerge(@Param("id") Long id);

    @Modifying
    @Query("UPDATE PrintOrder p SET p.status = 'COMPLETED' WHERE p.user = :user AND p.status = 'PRINTING'")
    void completeAllPrintingByUser(@Param("user") User user);
}