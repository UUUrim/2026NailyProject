package com.example.nailyproject.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zaxxer.hikari.HikariDataSource;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.*;

/**
 * '둘러보기' 공유 갤러리 저장소.
 * 계정·채팅·내 디자인·찜은 지금처럼 각자의 로컬 DB(spring.datasource)에 두고, 공유된 디자인과 좋아요만
 * 팀 전체가 같이 쓰는 갤러리 DB(naily.community-datasource, 보통 RDS)에 모은다.
 *
 * - 로컬 DB마다 id가 1번부터 시작해 겹치므로, 디자인과 좋아요한 사람은 항상 (originId, 로컬 id) 쌍으로 구분한다.
 * - 다른 사람의 백엔드는 내 로컬 DB를 읽을 수 없어서, 상세 모달·AR에 필요한 값(이미지, details, 쉐입, 손톱팁 크롭)을
 *   공유할 때 스냅샷으로 같이 저장해 둔다.
 * - DataSource를 빈으로 등록하면 Spring Boot의 로컬 DB 자동 설정이 꺼지므로, 이 클래스 안에서만 쓰는 커넥션 풀을 직접 만든다.
 *   풀은 처음 쓸 때 연결하므로 갤러리 DB가 꺼져 있어도 백엔드는 뜨고, 갤러리 말고는 로컬 DB로 정상 동작한다.
 * - ddl-auto는 로컬 DB에만 적용되므로 갤러리 테이블은 처음 쓸 때 CREATE TABLE IF NOT EXISTS로 만든다.
 */
@Repository
public class CommunityDesignStore {

    /** 갤러리 DB의 공유 디자인 한 건 (공유 시점 스냅샷) */
    public record CommunityDesign(Long id,
                                  String originId,
                                  Long originDesignId,
                                  Long ownerUserId,
                                  List<String> imageUrls,
                                  String detailsJson,
                                  String shape,
                                  List<String> nailTipCropUrls,
                                  LocalDateTime generatedAt,
                                  boolean shared,
                                  LocalDateTime sharedAt) {
    }

    /** 공유할 때 갤러리 DB에 올리는 값 */
    public record Snapshot(String originId,
                           Long originDesignId,
                           Long ownerUserId,
                           List<String> imageUrls,
                           String detailsJson,
                           String shape,
                           List<String> nailTipCropUrls,
                           LocalDateTime generatedAt) {
    }

    private static final String CREATE_DESIGNS_TABLE = """
            CREATE TABLE IF NOT EXISTS community_designs (
                id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                origin_id CHAR(36) NOT NULL,
                origin_design_id BIGINT NOT NULL,
                owner_user_id BIGINT NOT NULL,
                image_urls TEXT NOT NULL,
                details_json TEXT NULL,
                shape VARCHAR(30) NULL,
                nail_tip_crop_urls TEXT NULL,
                generated_at DATETIME(6) NULL,
                shared TINYINT(1) NOT NULL DEFAULT 1,
                shared_at DATETIME(6) NULL,
                UNIQUE KEY uk_community_designs_origin (origin_id, origin_design_id),
                KEY idx_community_designs_shared (shared, shared_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """;

    private static final String CREATE_LIKES_TABLE = """
            CREATE TABLE IF NOT EXISTS community_design_likes (
                id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                community_design_id BIGINT NOT NULL,
                liker_origin_id CHAR(36) NOT NULL,
                liker_user_id BIGINT NOT NULL,
                liked_at DATETIME(6) NOT NULL,
                UNIQUE KEY uk_community_design_likes (community_design_id, liker_origin_id, liker_user_id),
                KEY idx_community_design_likes_liker (liker_origin_id, liker_user_id),
                CONSTRAINT fk_community_design_likes_design FOREIGN KEY (community_design_id)
                    REFERENCES community_designs (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """;

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate namedJdbc;
    private final HikariDataSource ownDataSource; // 갤러리 DB를 따로 정하지 않아 로컬 DB를 같이 쓰면 null
    private final ObjectMapper objectMapper = new ObjectMapper();
    private volatile boolean schemaReady = false;

    public CommunityDesignStore(JdbcTemplate localJdbcTemplate,
                                @Value("${naily.community-datasource.url:}") String url,
                                @Value("${naily.community-datasource.username:}") String username,
                                @Value("${naily.community-datasource.password:}") String password,
                                @Value("${naily.community-datasource.maximum-pool-size:2}") int maximumPoolSize) {
        if (url == null || url.isBlank()) {
            // 갤러리 DB를 비워 두면 로컬 DB에 갤러리 테이블을 만든다 (같은 DB를 쓰는 사람끼리만 보인다)
            this.ownDataSource = null;
            this.jdbc = localJdbcTemplate;
        } else {
            HikariDataSource dataSource = new HikariDataSource();
            dataSource.setPoolName("community-gallery");
            dataSource.setJdbcUrl(url);
            dataSource.setUsername(username);
            dataSource.setPassword(password);
            // 팀원 여러 명의 백엔드가 같은 RDS에 붙으므로 연결을 적게, 쉬는 연결은 놓아 둔다
            dataSource.setMaximumPoolSize(maximumPoolSize);
            dataSource.setMinimumIdle(0);
            dataSource.setIdleTimeout(60000);
            dataSource.setMaxLifetime(600000);
            // 갤러리 DB가 꺼져 있을 때 둘러보기 요청이 오래 멈추지 않게 빨리 실패시킨다
            dataSource.setConnectionTimeout(5000);
            dataSource.addDataSourceProperty("connectTimeout", "5000");
            this.ownDataSource = dataSource;
            this.jdbc = new JdbcTemplate(dataSource);
        }
        this.namedJdbc = new NamedParameterJdbcTemplate(this.jdbc);
    }

    @PreDestroy
    void close() {
        if (ownDataSource != null) ownDataSource.close();
    }

    private void ensureSchema() {
        if (schemaReady) return;
        synchronized (this) {
            if (schemaReady) return;
            jdbc.execute(CREATE_DESIGNS_TABLE);
            jdbc.execute(CREATE_LIKES_TABLE);
            schemaReady = true;
        }
    }

    // ── 공유 디자인 ──────

    /** 공유하기 — 처음이면 새로 올리고, 공유 해제했다 다시 공유하면 스냅샷을 새로 고친다 (좋아요는 그대로) */
    public void upsertShared(Snapshot snapshot, LocalDateTime sharedAt) {
        ensureSchema();
        jdbc.update("""
                        INSERT INTO community_designs
                            (origin_id, origin_design_id, owner_user_id, image_urls, details_json, shape,
                             nail_tip_crop_urls, generated_at, shared, shared_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                        ON DUPLICATE KEY UPDATE
                            owner_user_id = VALUES(owner_user_id),
                            image_urls = VALUES(image_urls),
                            details_json = VALUES(details_json),
                            shape = VALUES(shape),
                            nail_tip_crop_urls = VALUES(nail_tip_crop_urls),
                            generated_at = VALUES(generated_at),
                            shared = 1,
                            shared_at = VALUES(shared_at)
                        """,
                snapshot.originId(), snapshot.originDesignId(), snapshot.ownerUserId(),
                writeList(snapshot.imageUrls()), snapshot.detailsJson(), snapshot.shape(),
                writeList(snapshot.nailTipCropUrls()), snapshot.generatedAt(), sharedAt);
    }

    /**
     * 공유 해제 — 행은 남겨 두고 목록에서만 뺀다. 로컬 DB에서 공유 해제해도 남들의 찜·좋아요가 남던 것과 맞춘다
     * (다시 공유하면 좋아요가 그대로 돌아온다).
     */
    public void markUnshared(String originId, Long originDesignId) {
        ensureSchema();
        jdbc.update("UPDATE community_designs SET shared = 0, shared_at = NULL WHERE origin_id = ? AND origin_design_id = ?",
                originId, originDesignId);
    }

    /** 디자인 삭제 — 좋아요는 FK(ON DELETE CASCADE)로 같이 지워진다 */
    public void deleteByOrigin(String originId, Long originDesignId) {
        ensureSchema();
        jdbc.update("DELETE FROM community_designs WHERE origin_id = ? AND origin_design_id = ?", originId, originDesignId);
    }

    /** 공유 뒤에 늦게 채워지는 값(스와치, 손톱팁 크롭)을 스냅샷에 반영한다 */
    public void updateDetails(String originId, Long originDesignId, String detailsJson, String shape, List<String> nailTipCropUrls) {
        ensureSchema();
        jdbc.update("UPDATE community_designs SET details_json = ?, shape = ?, nail_tip_crop_urls = ? WHERE origin_id = ? AND origin_design_id = ?",
                detailsJson, shape, writeList(nailTipCropUrls), originId, originDesignId);
    }

    public List<CommunityDesign> findShared(int limit) {
        ensureSchema();
        return jdbc.query("SELECT * FROM community_designs WHERE shared = 1 ORDER BY shared_at DESC LIMIT ?",
                designRowMapper(), limit);
    }

    public Optional<CommunityDesign> findById(Long id) {
        ensureSchema();
        return jdbc.query("SELECT * FROM community_designs WHERE id = ?", designRowMapper(), id).stream().findFirst();
    }

    public Optional<Long> findIdByOrigin(String originId, Long originDesignId) {
        ensureSchema();
        return jdbc.queryForList("SELECT id FROM community_designs WHERE origin_id = ? AND origin_design_id = ?",
                Long.class, originId, originDesignId).stream().findFirst();
    }

    /** ids 중 갤러리 DB에 아직 남아 있는 것 (원본이 삭제된 찜을 정리할 때 쓴다) */
    public Set<Long> findExistingIds(Collection<Long> ids) {
        if (ids.isEmpty()) return Set.of();
        ensureSchema();
        return new HashSet<>(namedJdbc.queryForList("SELECT id FROM community_designs WHERE id IN (:ids)",
                new MapSqlParameterSource("ids", ids), Long.class));
    }

    /** 이 로컬 DB에서 올린 디자인들의 공유 상태 — originDesignId → shared (서버 시작 때 로컬 DB와 맞추는 데 쓴다) */
    public Map<Long, Boolean> findSharedStatesByOrigin(String originId) {
        ensureSchema();
        Map<Long, Boolean> states = new HashMap<>();
        jdbc.query("SELECT origin_design_id, shared FROM community_designs WHERE origin_id = ?",
                rs -> {
                    states.put(rs.getLong("origin_design_id"), rs.getBoolean("shared"));
                }, originId);
        return states;
    }

    // ── 좋아요 ──────

    public Map<Long, Long> countLikes(Collection<Long> designIds) {
        Map<Long, Long> counts = new HashMap<>();
        if (designIds.isEmpty()) return counts;
        ensureSchema();
        namedJdbc.query("""
                        SELECT community_design_id, COUNT(*) AS cnt FROM community_design_likes
                        WHERE community_design_id IN (:ids) GROUP BY community_design_id
                        """,
                new MapSqlParameterSource("ids", designIds),
                rs -> {
                    counts.put(rs.getLong("community_design_id"), rs.getLong("cnt"));
                });
        return counts;
    }

    public long countLikes(Long designId) {
        ensureSchema();
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM community_design_likes WHERE community_design_id = ?",
                Long.class, designId);
        return count != null ? count : 0L;
    }

    public Set<Long> findLikedIds(String likerOriginId, Long likerUserId, Collection<Long> designIds) {
        if (designIds.isEmpty()) return Set.of();
        ensureSchema();
        return new HashSet<>(namedJdbc.queryForList("""
                        SELECT community_design_id FROM community_design_likes
                        WHERE liker_origin_id = :origin AND liker_user_id = :userId AND community_design_id IN (:ids)
                        """,
                new MapSqlParameterSource()
                        .addValue("origin", likerOriginId)
                        .addValue("userId", likerUserId)
                        .addValue("ids", designIds),
                Long.class));
    }

    public void addLike(Long designId, String likerOriginId, Long likerUserId, LocalDateTime likedAt) {
        ensureSchema();
        jdbc.update("""
                        INSERT IGNORE INTO community_design_likes (community_design_id, liker_origin_id, liker_user_id, liked_at)
                        VALUES (?, ?, ?, ?)
                        """,
                designId, likerOriginId, likerUserId, likedAt != null ? likedAt : LocalDateTime.now());
    }

    public void removeLike(Long designId, String likerOriginId, Long likerUserId) {
        ensureSchema();
        jdbc.update("DELETE FROM community_design_likes WHERE community_design_id = ? AND liker_origin_id = ? AND liker_user_id = ?",
                designId, likerOriginId, likerUserId);
    }

    // ── 내부 ──────

    private RowMapper<CommunityDesign> designRowMapper() {
        return (rs, rowNum) -> new CommunityDesign(
                rs.getLong("id"),
                rs.getString("origin_id"),
                rs.getLong("origin_design_id"),
                rs.getLong("owner_user_id"),
                readList(rs.getString("image_urls")),
                rs.getString("details_json"),
                rs.getString("shape"),
                rs.getString("nail_tip_crop_urls") != null ? readList(rs.getString("nail_tip_crop_urls")) : null,
                rs.getObject("generated_at", LocalDateTime.class),
                rs.getBoolean("shared"),
                rs.getObject("shared_at", LocalDateTime.class));
    }

    private String writeList(List<String> values) {
        if (values == null) return null;
        try {
            return objectMapper.writeValueAsString(values);
        } catch (Exception e) {
            throw new IllegalStateException("갤러리 스냅샷 저장 실패: " + e.getMessage(), e);
        }
    }

    private List<String> readList(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return objectMapper.readValue(json, objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));
        } catch (Exception e) {
            return List.of();
        }
    }
}
