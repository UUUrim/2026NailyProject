package com.example.nailyproject.repository;

import com.example.nailyproject.entity.ChatMessage;
import com.example.nailyproject.entity.DesignSession;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ChatMessageRepository extends JpaRepository<ChatMessage, Long> {
    // 세션의 모든 메시지 시간순 조회 (히스토리 복원용)
    List<ChatMessage> findBySessionOrderBySentAtAsc(DesignSession session);
}
