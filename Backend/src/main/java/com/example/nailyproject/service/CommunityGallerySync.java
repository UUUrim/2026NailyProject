package com.example.nailyproject.service;

import com.example.nailyproject.entity.DesignLike;
import com.example.nailyproject.repository.CommunityDesignStore;
import com.example.nailyproject.repository.DesignLikeRepository;
import com.example.nailyproject.repository.NailDesignRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.*;

/**
 * 서버가 뜰 때 로컬 DB를 갤러리 DB와 맞춘다.
 * - saved_designs.nail_design_id를 NULL 허용으로 바꾼다 (갤러리 id로 찜한 행은 로컬 디자인이 없다).
 *   ddl-auto: update는 이미 있는 컬럼의 NOT NULL을 풀지 않아서 직접 바꿔야 한다.
 * - 갤러리 DB가 생기기 전에 공유한 디자인(와 그 좋아요)을 올리고, 갤러리 DB에 못 닿았을 때 어긋난 공유 상태를 바로잡는다.
 *   팀원이 이 코드를 받아 서버를 켜기만 하면 예전 공유분도 둘러보기에 보인다.
 * 갤러리 DB는 느리거나 꺼져 있을 수 있어서 동기화는 별도 스레드에서 돌리고, 실패해도 서버는 그대로 뜬다.
 */
@Component
@RequiredArgsConstructor
public class CommunityGallerySync {

    private final JdbcTemplate jdbcTemplate;
    private final PlatformTransactionManager transactionManager;
    private final CommunityDesignStore communityDesignStore;
    private final LocalOriginService localOriginService;
    private final NailDesignRepository nailDesignRepository;
    private final DesignLikeRepository designLikeRepository;
    private final NailDesignService nailDesignService;

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        allowCommunitySaves();
        // 로컬 DB에 테이블을 만드는 일(DDL)이 요청 트랜잭션 도중에 일어나지 않게 미리 만들어 둔다
        localOriginService.getOriginId();

        Thread thread = new Thread(this::syncSharedDesigns, "community-gallery-sync");
        thread.setDaemon(true);
        thread.start();
    }

    private void allowCommunitySaves() {
        try {
            List<String> nullable = jdbcTemplate.queryForList("""
                    SELECT IS_NULLABLE FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'saved_designs' AND COLUMN_NAME = 'nail_design_id'
                    """, String.class);
            if (!nullable.isEmpty() && "NO".equals(nullable.get(0))) {
                jdbcTemplate.execute("ALTER TABLE saved_designs MODIFY nail_design_id BIGINT NULL");
                System.out.println("[CommunityGallery] saved_designs.nail_design_id를 NULL 허용으로 바꿨습니다.");
            }
        } catch (Exception e) {
            System.err.println("[CommunityGallery] saved_designs 컬럼 변경 실패 (다른 로컬 DB 디자인 찜이 안 될 수 있음): " + e.getMessage());
        }
    }

    void syncSharedDesigns() {
        try {
            String originId = localOriginService.getOriginId();
            Map<Long, Boolean> uploaded = communityDesignStore.findSharedStatesByOrigin(originId);

            TransactionTemplate tx = new TransactionTemplate(transactionManager);
            List<Long> sharedIds = tx.execute(status -> nailDesignRepository.findSharedIds());
            Set<Long> localShared = new HashSet<>(sharedIds != null ? sharedIds : List.of());

            int uploadedCount = 0;
            for (Long designId : localShared) {
                if (Boolean.TRUE.equals(uploaded.get(designId))) continue;
                boolean firstUpload = !uploaded.containsKey(designId);
                tx.executeWithoutResult(status -> nailDesignRepository.findById(designId).ifPresent(design -> {
                    communityDesignStore.upsertShared(nailDesignService.buildCommunitySnapshot(design),
                            design.getSharedAt() != null ? design.getSharedAt() : design.getGeneratedAt());
                    // 처음 올리는 디자인이면 로컬에 쌓여 있던 좋아요도 같이 옮긴다
                    if (firstUpload) {
                        communityDesignStore.findIdByOrigin(originId, designId).ifPresent(communityId -> {
                            for (DesignLike like : designLikeRepository.findAllByNailDesign(design)) {
                                communityDesignStore.addLike(communityId, originId, like.getUser().getId(), like.getLikedAt());
                            }
                        });
                    }
                }));
                uploadedCount++;
            }

            // 갤러리 DB에는 공유 중인데 로컬에서는 공유 해제됐거나 삭제된 디자인
            List<Long> existingLocal = uploaded.isEmpty() ? List.of() : tx.execute(status -> nailDesignRepository.findExistingIds(uploaded.keySet()));
            Set<Long> existingLocalIds = new HashSet<>(existingLocal != null ? existingLocal : List.of());
            int unsharedCount = 0;
            int deletedCount = 0;
            for (Map.Entry<Long, Boolean> entry : uploaded.entrySet()) {
                Long designId = entry.getKey();
                if (!existingLocalIds.contains(designId)) {
                    communityDesignStore.deleteByOrigin(originId, designId);
                    deletedCount++;
                } else if (entry.getValue() && !localShared.contains(designId)) {
                    communityDesignStore.markUnshared(originId, designId);
                    unsharedCount++;
                }
            }

            System.out.println("[CommunityGallery] 갤러리 DB 동기화 완료 (origin=" + originId + ", 올림 " + uploadedCount
                    + ", 공유 해제 " + unsharedCount + ", 삭제 " + deletedCount + ")");
        } catch (Exception e) {
            System.err.println("[CommunityGallery] 갤러리 DB 동기화 실패 — 둘러보기 DB 연결을 확인하세요: " + e.getMessage());
        }
    }
}
