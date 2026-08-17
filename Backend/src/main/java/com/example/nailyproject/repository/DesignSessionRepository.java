package com.example.nailyproject.repository;

import com.example.nailyproject.entity.DesignSession;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface DesignSessionRepository extends JpaRepository<DesignSession, Long> {
    Optional<DesignSession> findByIdAndUserId(Long sessionId, Long userId);
}
