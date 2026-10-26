package com.example.nailyproject.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "saved_designs")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@Builder
public class SavedDesign {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id", nullable = false)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    // 내 로컬 DB의 디자인. 다른 로컬 DB 사용자가 공유한 디자인을 둘러보기에서 찜했으면 null이고 communityDesignId를 쓴다.
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "nail_design_id")
    private NailDesign nailDesign;

    // 다른 로컬 DB 사용자가 공유한 디자인을 찜했을 때의 갤러리 DB id (community_designs.id).
    // 갤러리 DB는 다른 DB라 FK를 걸 수 없어서, 원본이 삭제되면 찜 목록을 불러올 때 정리한다.
    @Column(name = "community_design_id")
    private Long communityDesignId;

    @Column(name = "memo")
    private String memo;

    @CreationTimestamp
    @Column(name = "saved_at", nullable = false, updatable = false)
    private LocalDateTime savedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "saved_folder_id")
    private SavedFolder savedFolder; // null이면 폴더 미지정(레거시) — 신규 저장은 기본 폴더 사용

    //어떤 이미지를 찜했는지 기록용
    @Column(name = "image_url", nullable = false, length = 500)
    private String imageUrl;

    public void updateSavedFolder(SavedFolder savedFolder) {
        this.savedFolder = savedFolder;
    }
}