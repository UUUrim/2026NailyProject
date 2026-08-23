package com.example.nailyproject.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "saved_folders")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@Builder
public class SavedFolder {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id", nullable = false)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(name = "name", nullable = false, length = 50)
    private String name;

    /** 사용자 지정 정렬 순서 (작을수록 앞) */
    @Column(name = "sort_order", nullable = false)
    @Builder.Default
    private Integer sortOrder = 0;

    /** 기본 폴더 여부 (사용자당 하나). 필드명은 isDefault 피함(Spring Data 파싱 이슈) */
    @Column(name = "is_default", nullable = false, columnDefinition = "tinyint(1) not null default 0")
    @Builder.Default
    private boolean defaultFolder = false;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    public void updateName(String name) {
        this.name = name;
    }

    public void updateSortOrder(Integer sortOrder) {
        this.sortOrder = sortOrder;
    }

    public void markAsDefault() {
        this.defaultFolder = true;
    }

    public void unmarkAsDefault() {
        this.defaultFolder = false;
    }
}