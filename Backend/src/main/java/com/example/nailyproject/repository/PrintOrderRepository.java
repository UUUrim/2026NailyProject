package com.example.nailyproject.repository;

import com.example.nailyproject.entity.PrintOrder;
import com.example.nailyproject.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PrintOrderRepository extends JpaRepository<PrintOrder, Long> {

    List<PrintOrder> findAllByUserOrderByOrderedAtDesc(User user);
}