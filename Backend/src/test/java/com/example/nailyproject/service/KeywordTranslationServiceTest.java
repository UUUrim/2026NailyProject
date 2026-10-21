package com.example.nailyproject.service;

import com.example.nailyproject.entity.KeywordTranslation;
import com.example.nailyproject.repository.KeywordTranslationRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * 결과 화면 키워드 번역 — 저장된 번역은 그대로 쓰고, 모르는 말만 GPT에 한 번 물어 저장하는지 확인한다.
 * GPT와 DB는 가짜로 바꿔 실제로 부르지 않는다.
 */
class KeywordTranslationServiceTest {

    private KeywordTranslationRepository repository;
    private GptClientService gpt;
    private KeywordTranslationService service;

    @BeforeEach
    void setUp() {
        repository = mock(KeywordTranslationRepository.class);
        gpt = mock(GptClientService.class);
        when(repository.findAll()).thenReturn(List.of());
        when(repository.findAllByEnglishIn(any())).thenReturn(List.of());
        service = new KeywordTranslationService(repository, gpt, new ObjectMapper());
    }

    private static KeywordTranslation saved(String english, String korean) {
        return KeywordTranslation.builder().english(english).korean(korean).build();
    }

    @Test
    void 저장된_번역은_GPT를_부르지_않는다() {
        when(repository.findAll()).thenReturn(List.of(saved("fresh", "산뜻")));
        when(repository.findAllByEnglishIn(any())).thenReturn(List.of(saved("fresh", "산뜻")));

        assertEquals(Map.of("fresh", "산뜻"), service.translate(List.of("Fresh")));
        verifyNoInteractions(gpt);
    }

    @Test
    void DB는_번역용_스레드에서만_읽고_쓴다() {
        // 디자인 생성 요청 스레드(=DB 트랜잭션)에서 번역 테이블을 건드리면, 실패했을 때 생성 트랜잭션까지 되돌려진다
        List<String> dbThreads = new CopyOnWriteArrayList<>();
        when(repository.findAll()).thenAnswer(invocation -> {
            dbThreads.add(Thread.currentThread().getName());
            return List.of();
        });
        when(repository.findAllByEnglishIn(any())).thenAnswer(invocation -> {
            dbThreads.add(Thread.currentThread().getName());
            return List.of();
        });
        when(repository.save(any(KeywordTranslation.class))).thenAnswer(invocation -> {
            dbThreads.add(Thread.currentThread().getName());
            return invocation.getArgument(0);
        });
        when(gpt.chat(anyString(), anyString(), anyInt(), anyBoolean()))
                .thenReturn("{\"translations\": {\"fresh\": \"산뜻\"}}");

        service.prefetch(List.of("fresh"));
        assertEquals(Map.of("fresh", "산뜻"), service.translate(List.of("fresh")));

        assertFalse(dbThreads.isEmpty());
        assertTrue(dbThreads.stream().allMatch("keyword-translation"::equals), dbThreads.toString());
    }

    @Test
    void DB가_실패해도_예외_없이_빈_결과를_돌려준다() {
        when(repository.findAll()).thenThrow(new RuntimeException("Table 'keyword_translations' doesn't exist"));
        when(repository.findAllByEnglishIn(any())).thenThrow(new RuntimeException("Table 'keyword_translations' doesn't exist"));

        assertDoesNotThrow(() -> service.prefetch(List.of("fresh")));
        assertEquals(Map.of(), service.translate(List.of("fresh")));
        verifyNoInteractions(gpt);
    }

    @Test
    void 모르는_말은_GPT로_번역해_저장하고_다음엔_다시_묻지_않는다() {
        when(gpt.chat(anyString(), anyString(), anyInt(), anyBoolean()))
                .thenReturn("{\"translations\": {\"fruit pattern\": \"과일\", \"drawing\": \"드로잉\"}}");

        assertEquals(Map.of("fruit pattern", "과일", "drawing", "드로잉"),
                service.translate(List.of("fruit pattern", "Drawing")));
        assertEquals(Map.of("fruit pattern", "과일"), service.translate(List.of("fruit  pattern")));

        verify(gpt, times(1)).chat(anyString(), anyString(), anyInt(), anyBoolean());
        verify(repository, times(2)).save(any(KeywordTranslation.class));
    }

    @Test
    void 미리_시작한_번역을_기다리고_같은_말을_두_번_묻지_않는다() throws Exception {
        CountDownLatch answer = new CountDownLatch(1);
        when(gpt.chat(anyString(), anyString(), anyInt(), anyBoolean())).thenAnswer(invocation -> {
            answer.await(5, TimeUnit.SECONDS); // 이미지를 만드는 동안 번역이 진행되는 상황
            return "{\"translations\": {\"fresh\": \"산뜻\"}}";
        });

        service.prefetch(List.of("fresh"));
        Thread waiter = new Thread(answer::countDown);
        waiter.start();
        assertEquals(Map.of("fresh", "산뜻"), service.translate(List.of("fresh")));

        verify(gpt, times(1)).chat(anyString(), anyString(), anyInt(), anyBoolean());
    }

    @Test
    void 영어가_섞이거나_빈_답은_빈_문자열로_저장하고_답에_빠진_말은_저장하지_않는다() {
        when(gpt.chat(anyString(), anyString(), anyInt(), anyBoolean()))
                .thenReturn("{\"translations\": {\"none\": \"\", \"sparkle\": \"sparkle 반짝\", \"3d bow\": \"3D 리본\"}}");

        Map<String, String> result = service.translate(List.of("none", "sparkle", "3d bow", "aurora"));

        assertEquals(Map.of("none", "", "sparkle", "", "3d bow", "3D 리본"), result);
        verify(repository).save(argThat(t -> t.getEnglish().equals("none") && t.getKorean().isEmpty()));
        verify(repository).save(argThat(t -> t.getEnglish().equals("sparkle") && t.getKorean().isEmpty()));
        verify(repository, never()).save(argThat(t -> t.getEnglish().equals("aurora")));
    }

    @Test
    void GPT가_실패해도_예외_없이_빈_결과를_돌려주고_다음에_다시_묻는다() {
        when(gpt.chat(anyString(), anyString(), anyInt(), anyBoolean()))
                .thenThrow(new RuntimeException("network"))
                .thenReturn("{\"translations\": {\"fresh\": \"산뜻\"}}");

        assertEquals(Map.of(), service.translate(List.of("fresh")));
        assertEquals(Map.of("fresh", "산뜻"), service.translate(List.of("fresh")));
    }

    @Test
    void 문장처럼_긴_말은_번역하지_않는다() {
        String sentence = "a very long sentence that the slot extraction accidentally stored as a single value";

        assertEquals(Map.of(), service.translate(List.of(sentence)));
        verifyNoInteractions(gpt);
    }
}
