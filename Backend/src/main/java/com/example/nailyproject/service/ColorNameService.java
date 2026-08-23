package com.example.nailyproject.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;

/**
 * hex 색상을 사람이 읽는 영어 이름으로 변환한다.
 * 1순위: api.color.pizza (30,000개 이상의 색상 데이터베이스, 무료, 키 불필요)
 * 2순위(API 실패/네트워크 문제 시): ColorNameResolver의 로컬 팔레트로 폴백
 * 같은 hex를 반복 조회하지 않도록 메모리 캐시를 둔다.
 */
@Service
@RequiredArgsConstructor
public class ColorNameService {

    private final WebClient.Builder webClientBuilder;
    private final Map<String, String> cache = new ConcurrentHashMap<>();

    private static final String API_URL = "https://api.color.pizza/v1/";

    /** hex 하나를 이름으로 변환 */
    public String resolveColorName(String hex) {
        String normalized = normalize(hex);
        if (normalized == null) return hex;
        if (cache.containsKey(normalized)) return cache.get(normalized);

        List<String> resolved = resolveColorNames(List.of(hex));
        return resolved.isEmpty() ? hex : resolved.get(0);
    }

    /** 여러 hex를 한 번의 API 호출로 변환 (효율적) */
    public List<String> resolveColorNames(List<String> hexes) {
        List<String> normalizedList = hexes.stream()
                .map(this::normalize)
                .filter(Objects::nonNull)
                .toList();

        List<String> toFetch = normalizedList.stream()
                .filter(h -> !cache.containsKey(h))
                .distinct()
                .toList();

        if (!toFetch.isEmpty()) {
            fetchBatchFromApi(toFetch);
        }

        return normalizedList.stream()
                .map(h -> cache.getOrDefault(h, ColorNameResolver.nearestColorName("#" + h)))
                .toList();
    }

    private String normalize(String hex) {
        if (hex == null) return null;
        String h = hex.trim().replace("#", "").toLowerCase();
        return h.isBlank() ? null : h;
    }

    private void fetchBatchFromApi(List<String> normalizedHexes) {
        try {
            String values = String.join(",", normalizedHexes);
            JsonNode response = webClientBuilder.build()
                    .get()
                    .uri(API_URL + "?values=" + values)
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .block();

            JsonNode colors = response.path("colors");
            for (int i = 0; i < colors.size() && i < normalizedHexes.size(); i++) {
                String name = colors.get(i).path("name").asText();
                if (name != null && !name.isBlank()) {
                    cache.put(normalizedHexes.get(i), name);
                }
            }
        } catch (Exception e) {
            System.err.println("색상 이름 API 호출 실패, 로컬 팔레트로 대체합니다: " + e.getMessage());
            for (String hex : normalizedHexes) {
                cache.put(hex, ColorNameResolver.nearestColorName("#" + hex));
            }
        }
    }
}