package com.example.nailyproject.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * 둘러보기 커뮤니티 '좋아요' — 찜(SavedDesign)과 완전히 분리.
 * 사용자당 디자인 1건에 좋아요 1회.
 */
@Entity
@Table(
        name = "design_likes",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_design_likes_user_design",
                columnNames = {"user_id", "nail_design_id"}
        )
)
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@Builder
public class DesignLike {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id", nullable = false)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "nail_design_id", nullable = false)
    private NailDesign nailDesign;

    @CreationTimestamp
    @Column(name = "liked_at", nullable = false, updatable = false)
    private LocalDateTime likedAt;
}
