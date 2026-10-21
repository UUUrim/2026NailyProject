package com.example.nailyproject.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * 결과 화면 키워드 칩의 영어 → 한글 번역. NailDesignService의 사전(KO_WORDS/KO_PHRASES)에 없는 말을
 * GPT로 한 번 번역해 저장해 두고 다음부터 그대로 쓴다 (KeywordTranslationService).
 * 번역이 마음에 안 들면 이 테이블의 korean을 직접 고치면 된다 — 서버가 몇 분 안에 다시 읽어 간다(재시작 불필요).
 */
@Entity
@Table(
        name = "keyword_translations",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_keyword_translations_english",
                columnNames = {"english"}
        )
)
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
@Builder
public class KeywordTranslation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id", nullable = false)
    private Long id;

    /** 영어 원문 — 소문자, 공백 하나로 정리한 값 (예: "fruit pattern") */
    @Column(name = "english", nullable = false, length = 100)
    private String english;

    /** 한글 칩 표기 (예: "과일"). 빈 문자열이면 칩으로 쓸 뜻이 없는 말이라 키워드에서 뺀다 */
    @Column(name = "korean", nullable = false, length = 50)
    private String korean;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;
}
