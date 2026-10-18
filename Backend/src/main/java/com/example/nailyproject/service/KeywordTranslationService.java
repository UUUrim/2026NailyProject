package com.example.nailyproject.service;

import com.example.nailyproject.entity.KeywordTranslation;
import com.example.nailyproject.repository.KeywordTranslationRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/**
 * 결과 화면 키워드 칩의 영어 → 한글 번역 (표시 전용 — 슬롯·플랜·프롬프트는 건드리지 않는다).
 * NailDesignService의 사전(KO_WORDS/KO_PHRASES)으로 한글이 안 되는 말만 여기로 온다.
 * 1. DB(keyword_translations)에 저장된 번역이 있으면 그걸 쓴다.
 * 2. 없으면 GPT(채팅과 같은 모델)로 번역해 저장한다 — 같은 말은 한 번만 번역한다.
 * 이미지를 만들기 전에 prefetch로 번역을 시작해 두면 이미지를 만드는 동안 끝나서 응답이 늦어지지 않는다.
 * 칩으로 쓸 뜻이 없는 말(none, 문장 등)은 빈 문자열로 저장해 다시 묻지 않는다(→ 칩에서 빠진다).
 * DB에서 번역을 직접 고치면 CACHE_TTL 안에 반영된다 (재시작 불필요).
 *
 * DB 읽기·쓰기는 모두 번역용 스레드(keyword-translation)에서만 한다. 디자인 생성·수정은 처리 전체가 한 DB 트랜잭션이라,
 * 그 요청 스레드에서 번역 테이블을 읽다 실패하면(테이블이 없거나 DB 오류) 예외를 잡아도 트랜잭션 전체가 되돌려져
 * 생성이 실패한다. 요청 스레드는 메모리(cache)만 보고, 공개 메서드는 어떤 경우에도 예외를 밖으로 내보내지 않는다
 * — 번역이 안 되면 그 키워드 칩만 빠진다.
 */
@Service
@RequiredArgsConstructor
public class KeywordTranslationService {

    private static final Duration CACHE_TTL = Duration.ofMinutes(5);
    // 결과 응답을 위해 번역을 기다리는 최대 시간 — 넘기면 이번 응답에선 그 키워드를 빼고(번역은 계속 진행돼 저장된다)
    private static final long MAX_WAIT_MS = 10_000;
    private static final int MAX_ENGLISH_LENGTH = 60;
    private static final int MAX_KOREAN_LENGTH = 15;
    // 한글 칩에 남아도 되는 영문 표기 (NailDesignService.ALLOWED_LATIN과 같다)
    private static final Pattern ALLOWED_LATIN = Pattern.compile("3D|Y2K");

    private static final String SYSTEM_PROMPT = """
            You turn short English keywords from a Korean nail-design app into Korean labels for small result-screen chips.
            Return a JSON object {"translations": {"<keyword exactly as given>": "<Korean label>"}} with every given keyword as a key.
            Rules:
            - Use the words Korean nail shops and customers actually use. Keep common nail loanwords as loanwords
              (glitter -> 글리터, french tip -> 프렌치, marble -> 마블, chrome -> 크롬, drawing -> 드로잉, lovely -> 러블리, chic -> 시크),
              otherwise use natural Korean (fresh -> 산뜻, fruit -> 과일, cloud -> 구름, sparkling -> 반짝임).
            - Keep it short: one or two words, at most 8 Korean characters. For moods and adjectives use the root without 한/하게/스러운
              (elegant -> 우아, fresh -> 산뜻, delicate -> 섬세, dreamy -> 몽환).
            - Drop words that only say it is a design element: pattern, motif, design, style, art, nail, nails, finish, accent, detail
              (fruit pattern -> 과일, star motif -> 별, cherry art -> 체리).
            - Color words follow the same style (light pink -> 라이트 핑크, dusty rose -> 애쉬 로즈).
            - No English letters in the label (3D and Y2K may stay as they are). No explanations, no quotes.
            - If a keyword has no meaning as a style label (none, n/a, random letters, a whole sentence), use "".
            """;

    private final KeywordTranslationRepository keywordTranslationRepository;
    private final GptClientService gptClientService;
    private final ObjectMapper objectMapper;

    private final ExecutorService executor = Executors.newFixedThreadPool(2, runnable -> {
        Thread thread = new Thread(runnable, "keyword-translation");
        thread.setDaemon(true);
        return thread;
    });
    // 번역 중인 말 → 그 번역 결과. 같은 말을 동시에 두 번 묻지 않게 한다
    private final Map<String, CompletableFuture<String>> inFlight = new ConcurrentHashMap<>();
    // 저장된 번역 (영어 정리형 → 한글, 뜻 없는 말은 "")
    private volatile Map<String, String> cache = new ConcurrentHashMap<>();
    private volatile Instant loadedAt = Instant.EPOCH;
    private final AtomicBoolean refreshing = new AtomicBoolean(false);

    /** 번역 저장소의 키 — 소문자, 공백 하나. 비었거나 너무 길면(문장) null */
    public static String normalize(String english) {
        if (english == null) return null;
        String key = english.trim().toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");
        return key.isEmpty() || key.length() > MAX_ENGLISH_LENGTH ? null : key;
    }

    /** 아직 번역이 없는 말의 번역을 시작해 둔다 (기다리지 않는다). 이미지를 만들기 전에 부른다. */
    public void prefetch(Collection<String> englishWords) {
        try {
            start(englishWords, new HashMap<>());
        } catch (RuntimeException e) {
            System.err.println("[Keyword] 키워드 번역을 시작하지 못했습니다(칩만 빠짐): " + e.getMessage());
        }
    }

    /**
     * 말들의 한글 번역 (키 = normalize한 영어). 저장된 번역은 바로, 번역 중이거나 새로 번역할 말은 최대 MAX_WAIT_MS 기다린다.
     * 뜻 없는 말은 "", 번역을 못 받은 말은 결과에 없다.
     */
    public Map<String, String> translate(Collection<String> englishWords) {
        Map<String, String> result = new HashMap<>();
        Map<String, CompletableFuture<String>> pending;
        try {
            pending = start(englishWords, result);
        } catch (RuntimeException e) {
            System.err.println("[Keyword] 키워드 번역을 시작하지 못했습니다(칩만 빠짐): " + e.getMessage());
            return result;
        }
        long deadline = System.currentTimeMillis() + MAX_WAIT_MS;
        for (Map.Entry<String, CompletableFuture<String>> entry : pending.entrySet()) {
            long left = deadline - System.currentTimeMillis();
            try {
                String korean = left > 0
                        ? entry.getValue().get(left, TimeUnit.MILLISECONDS)
                        : entry.getValue().getNow(null);
                if (korean != null) result.put(entry.getKey(), korean);
            } catch (TimeoutException e) {
                System.err.println("[Keyword] 번역이 늦어 이번 결과에서는 뺍니다(번역은 계속돼 저장됨): '" + entry.getKey() + "'");
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (ExecutionException e) {
                // 번역 실패 — 이번 결과에서는 빠지고, 다음에 다시 묻는다
            }
        }
        return result;
    }

    /** 저장된 번역은 found에 담고, 아직 없는 말은 번역을 시작(또는 진행 중인 번역에 합류)해 기다릴 결과를 돌려준다 */
    private Map<String, CompletableFuture<String>> start(Collection<String> englishWords, Map<String, String> found) {
        refreshInBackgroundIfStale();
        Map<String, CompletableFuture<String>> pending = new LinkedHashMap<>();
        Map<String, CompletableFuture<String>> started = new LinkedHashMap<>(); // 이번에 새로 번역을 시작한 말
        CompletableFuture<Map<String, String>> batch = new CompletableFuture<>();
        for (String english : englishWords) {
            String key = normalize(english);
            if (key == null || found.containsKey(key) || pending.containsKey(key)) continue;
            String cached = cache.get(key);
            if (cached != null) {
                found.put(key, cached);
                continue;
            }
            CompletableFuture<String> mine = batch.thenApply(translated -> translated.get(key));
            CompletableFuture<String> existing = inFlight.putIfAbsent(key, mine);
            pending.put(key, existing != null ? existing : mine);
            if (existing == null) started.put(key, mine);
        }
        if (started.isEmpty()) return pending;

        List<String> toAsk = new ArrayList<>(started.keySet());
        try {
            executor.execute(() -> {
                Map<String, String> translated = Map.of();
                try {
                    translated = loadOrAsk(toAsk);
                } catch (Exception e) {
                    System.err.println("[Keyword] 키워드 번역 실패(다음에 다시 시도): " + toAsk + " - " + e.getMessage());
                } finally {
                    // 진행 중 표시를 먼저 지운다 — 결과를 알린 뒤에 지우면 그 사이 들어온 요청이 실패한 번역에 합류해 다시 묻지 못한다
                    // (성공한 번역은 이미 cache에 있다)
                    started.forEach(inFlight::remove);
                    batch.complete(translated);
                }
            });
        } catch (RuntimeException e) {
            // 번역 스레드에 맡기지 못했다 — 기다리는 쪽이 멈춰 있지 않게 바로 끝낸다
            started.forEach(inFlight::remove);
            batch.complete(Map.of());
            System.err.println("[Keyword] 키워드 번역을 맡기지 못했습니다(칩만 빠짐): " + e.getMessage());
        }
        return pending;
    }

    /** DB에 이미 있는 건 그대로, 없는 것만 GPT에 한 번에 물어 저장한다 */
    private Map<String, String> loadOrAsk(List<String> keys) throws Exception {
        Map<String, String> result = new HashMap<>();
        for (KeywordTranslation saved : keywordTranslationRepository.findAllByEnglishIn(keys)) {
            result.put(saved.getEnglish(), Objects.requireNonNullElse(saved.getKorean(), ""));
        }
        cache.putAll(result);
        List<String> missing = keys.stream().filter(key -> !result.containsKey(key)).toList();
        if (missing.isEmpty()) return result;

        String reply = gptClientService.chat(SYSTEM_PROMPT,
                objectMapper.writeValueAsString(Map.of("keywords", missing)),
                80 + 40 * missing.size(), true);
        // 키 대소문자를 바꿔 답하는 경우도 받아 준다
        Map<String, String> answered = new HashMap<>();
        objectMapper.readTree(reply).path("translations").fields().forEachRemaining(field -> {
            JsonNode value = field.getValue();
            if (value.isTextual()) answered.put(normalize(field.getKey()), value.asText());
        });

        for (String key : missing) {
            String raw = answered.get(key);
            if (raw == null) continue; // 답에서 빠진 말은 저장하지 않고 다음에 다시 묻는다
            String korean = cleanKorean(raw);
            save(key, korean);
            result.put(key, korean);
            cache.put(key, korean);
            System.out.println("[Keyword] GPT 번역 저장: '" + key + "' → '" + korean + "'"
                    + (korean.isEmpty() ? " (칩으로 쓸 뜻이 없어 제외)" : ""));
        }
        return result;
    }

    /** 칩에 쓸 수 있는 한글이면 그대로, 영어가 섞였거나 너무 길면 "" (= 키워드에서 뺀다) */
    private String cleanKorean(String raw) {
        String korean = raw.trim().replaceAll("^[\"'“”‘’]+|[\"'“”‘’]+$", "").trim();
        if (korean.isEmpty() || korean.length() > MAX_KOREAN_LENGTH) return "";
        if (ALLOWED_LATIN.matcher(korean).replaceAll("").matches(".*[A-Za-z].*")) return "";
        if (!korean.matches(".*[가-힣].*") && !ALLOWED_LATIN.matcher(korean).find()) return "";
        return korean;
    }

    private void save(String english, String korean) {
        try {
            keywordTranslationRepository.save(KeywordTranslation.builder().english(english).korean(korean).build());
        } catch (DataIntegrityViolationException e) {
            // 다른 요청이 같은 말을 먼저 저장했다 — 그 번역을 쓰면 된다
        }
    }

    /**
     * 저장된 번역을 CACHE_TTL마다 DB에서 다시 읽는다 (DB에서 직접 고친 번역이 반영되게).
     * 번역용 스레드에서 읽고 요청은 기다리지 않는다 — 그동안 cache에 없는 말은 loadOrAsk가 DB부터 찾으므로 다시 번역하지 않는다.
     */
    private void refreshInBackgroundIfStale() {
        if (Duration.between(loadedAt, Instant.now()).compareTo(CACHE_TTL) < 0) return;
        if (!refreshing.compareAndSet(false, true)) return;
        try {
            executor.execute(() -> {
                try {
                    Map<String, String> fresh = new ConcurrentHashMap<>();
                    for (KeywordTranslation saved : keywordTranslationRepository.findAll()) {
                        fresh.put(saved.getEnglish(), Objects.requireNonNullElse(saved.getKorean(), ""));
                    }
                    cache = fresh;
                } catch (Exception e) {
                    System.err.println("[Keyword] 저장된 키워드 번역을 읽지 못했습니다(이전 값 유지): " + e.getMessage());
                } finally {
                    loadedAt = Instant.now();
                    refreshing.set(false);
                }
            });
        } catch (RuntimeException e) {
            refreshing.set(false);
            System.err.println("[Keyword] 저장된 키워드 번역 다시 읽기를 맡기지 못했습니다: " + e.getMessage());
        }
    }
}
