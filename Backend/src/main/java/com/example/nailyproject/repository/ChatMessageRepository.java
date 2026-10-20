package com.example.nailyproject.repository;

import com.example.nailyproject.entity.ChatMessage;
import com.example.nailyproject.entity.DesignSession;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface ChatMessageRepository extends JpaRepository<ChatMessage, Long> {
    // 세션의 모든 메시지 시간순 조회 (히스토리 복원용)
    // 보낸 시각이 같으면 저장한 순서(id)로 — 수정 요청은 사용자 메시지와 답변을 한 트랜잭션에서 잇달아 저장해서 시각이 같을 수 있다
    @Query("select m from ChatMessage m where m.session = :session order by m.sentAt asc, m.id asc")
    List<ChatMessage> findBySessionOrderBySentAtAsc(@Param("session") DesignSession session);
}
