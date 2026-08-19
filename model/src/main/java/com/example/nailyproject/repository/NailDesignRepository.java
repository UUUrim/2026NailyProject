package com.example.nailyproject.repository;

import com.example.nailyproject.entity.NailDesign;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface NailDesignRepository extends JpaRepository<NailDesign, Long> {
}