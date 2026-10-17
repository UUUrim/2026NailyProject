package com.example.nailyproject.repository;

import com.example.nailyproject.dto.response.ChatSummaryDto;
import com.example.nailyproject.entity.DesignSession;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface DesignSessionRepository extends JpaRepository<DesignSession, Long> {
    Optional<DesignSession> findByIdAndUserId(Long sessionId, Long userId);

    // 디자인 채팅 사이드바의 채팅 이력 — 저장된 채팅만, 최근에 이어 한 순서로 (큰 채팅 상태 JSON은 읽지 않는다)
    @Query("select new com.example.nailyproject.dto.response.ChatSummaryDto(s.id, s.title, s.scanKey, s.createdAt, s.updatedAt) "
            + "from DesignSession s where s.user.id = :userId and s.chatState is not null "
            + "order by s.updatedAt desc")
    List<ChatSummaryDto> findChatSummaries(@Param("userId") Long userId);

    // 채팅 검색 — 이름이나 채팅 화면 상태(JSON)에 검색어가 들어간 채팅을 최근 순으로 추린다.
    // JSON 키 등에 걸린 것은 ChatService가 말풍선 글을 다시 확인해서 걸러낸다. pattern은 '!'로 이스케이프한 "%검색어%"
    @Query("select s from DesignSession s where s.user.id = :userId and s.chatState is not null "
            + "and (lower(s.title) like :pattern escape '!' or lower(s.chatState) like :pattern escape '!') "
            + "order by s.updatedAt desc")
    List<DesignSession> searchChats(@Param("userId") Long userId, @Param("pattern") String pattern);
}
