package com.example.nailyproject.service;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * 이 백엔드가 붙은 로컬 DB를 구분하는 UUID.
 * 로컬 DB마다 user·디자인 id가 1번부터 시작해 겹치므로, 갤러리 DB에는 항상 (originId, 로컬 id) 쌍으로 적는다.
 * 로컬 DB에 처음 붙을 때 한 번 만들어 naily_instance 테이블에 저장해 두므로 따로 설정할 것이 없다.
 * (같은 DB를 쓰는 백엔드끼리는 같은 값을 쓴다. DB를 통째로 복사해 다른 사람이 쓰면 값이 겹치니 그때는 이 행을 지운다.)
 */
@Service
@RequiredArgsConstructor
public class LocalOriginService {

    private final JdbcTemplate jdbcTemplate;
    private volatile String originId;

    public String getOriginId() {
        if (originId == null) {
            synchronized (this) {
                if (originId == null) originId = loadOrCreate();
            }
        }
        return originId;
    }

    private String loadOrCreate() {
        jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS naily_instance (
                    id TINYINT NOT NULL PRIMARY KEY,
                    origin_id CHAR(36) NOT NULL,
                    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                )
                """);
        // 같은 DB에 백엔드 여러 개가 동시에 떠도 행은 하나만 생긴다
        jdbcTemplate.update("INSERT IGNORE INTO naily_instance (id, origin_id) VALUES (1, ?)", UUID.randomUUID().toString());
        return jdbcTemplate.queryForObject("SELECT origin_id FROM naily_instance WHERE id = 1", String.class);
    }
}
