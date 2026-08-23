package com.example.nailyproject.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "chat_messages")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@Builder
public class ChatMessage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id", nullable = false)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "session_id", nullable = false)
    private DesignSession session;

    @Enumerated(EnumType.STRING)
    @Column(name = "role", nullable = false)
    private MessageRole role;

    @Column(name = "content", nullable = false, columnDefinition = "TEXT")
    private String content;

    @CreationTimestamp
    @Column(name = "sent_at", nullable = false, updatable = false)
    private LocalDateTime sentAt;

    public enum MessageRole {
        user, assistant
    }
}
