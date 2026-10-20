package com.example.nailyproject.service;

import org.junit.jupiter.api.Test;

import static com.example.nailyproject.service.TextureExtractService.mentionedPositively;
import static com.example.nailyproject.service.TextureExtractService.stripAvoidClauses;
import static org.junit.jupiter.api.Assertions.*;

class TextureExtractNegationTest {

    @Test
    void avoidClausesAreRemoved() {
        String prompt = "Nail 1:\nSoft pink syrup gel. Avoid: matte, no pearls. Magnetic glass-bead glow.\n"
                + "Nail 2:\nIvory solid.\n\nAvoid: no matte, no pink.";
        String cleaned = stripAvoidClauses(prompt);
        assertFalse(cleaned.toLowerCase().contains("matte"), cleaned);
        assertTrue(cleaned.contains("Magnetic glass-bead glow."), "Avoid 절 뒤의 문장은 남아야 한다: " + cleaned);
        assertTrue(cleaned.contains("Ivory solid."), cleaned);
    }

    @Test
    void negatedMentionsAreNotCounted() {
        assertFalse(mentionedPositively("Avoid: no matte, no pink.", "matte"));
        assertFalse(mentionedPositively("Please do not use matte on any nail.", "matte"));
        assertFalse(mentionedPositively("Soft pink syrup, without glitter.", "glitter"));
        // 프롬프트마다 들어가는 안내 문장 (글리터/니트가 쓰이지 않아도 단어가 들어 있다)
        assertFalse(mentionedPositively("Unless the design explicitly calls for glitter, render every shimmery surface as a "
                + "smooth, continuous gloss — never as scattered glitter specks or sparkle dust.", "glitter"));
        assertFalse(mentionedPositively("even with no texture of its own (except the knit fibers or ink check that a nail's "
                + "own description specifies), and the clear top gel stays smooth.", "knit"));
    }

    @Test
    void positiveMentionsAreCounted() {
        assertTrue(mentionedPositively("Material and finish: matte finish, fine nail-art details.", "matte"));
        assertTrue(mentionedPositively("Nail 3: milky pink syrup with fine glitter floating inside.", "glitter"));
        // 앞 절에 부정어가 있어도 절이 다르면 영향 없음
        assertTrue(mentionedPositively("Not too bright, with glitter finish on the ring nail.", "glitter"));
        assertFalse(mentionedPositively("Nothing special here.", "glitter"));
    }
}
