package com.example.nailyproject.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class StyleTrendService {

    private final ObjectMapper objectMapper;
    private JsonNode styleData;

    @PostConstruct
    public void init() {
        try {
            ClassPathResource resource = new ClassPathResource("style_associations.json");
            styleData = objectMapper.readTree(resource.getInputStream());
            System.out.println("[StyleTrendService] JSON 로드 성공");
        } catch (Exception e) {
            System.err.println("[StyleTrendService] JSON 로드 실패: " + e.getMessage());
            styleData = null;
        }
    }

    /**
     * 현재 날짜 기준 시즌을 판단하고, 해당 시즌에 lift가 높은 모티프를 담은
     * 프롬프트 힌트 문자열을 반환. ChatService와 FingerDesignPlanService에서 사용.
     */

    public String buildTrendHint() {
        return buildTrendHint(null);
    }
    public String buildTrendHint(String userSeason) {
        if (styleData == null) return "";

        String season = (userSeason != null && !userSeason.isBlank())
                ? userSeason : getCurrentSeason();

        List<MotifEntry> topMotifs = getTopMotifsBySeason(season, 10);
        if (topMotifs.isEmpty()) return "";

        StringBuilder sb = new StringBuilder();
        sb.append("[이번 시즌 트렌드 참고 팔레트 - ").append(season).append("]\n");
        sb.append("이미지 스타일과 어울린다면 아래 모티프/무드/컬러를 우선적으로 활용하세요.\n");
        // 날짜 기준으로 정한 계절이면, 이벤트 소재가 아니라 그 계절 분위기로 추천하게 한다.
        if (userSeason == null || userSeason.isBlank()) {
            String label = switch (season) {
                case "autumn" -> "가을";
                case "spring" -> "봄";
                case "summer" -> "여름";
                case "winter" -> "겨울";
                default -> null;
            };
            if (label != null) {
                sb.append("지금은 실제로 ").append(label).append("입니다. 사용자가 이벤트(핼러윈, 크리스마스 등)를 직접 말하지 않았다면 ")
                        .append("이벤트 소재가 아니라 ").append(label).append(" 계절감(그 계절의 컬러, 질감, 무드)을 중심으로 추천하세요.\n");
            }
        }
        sb.append("\n");

        // 상위 5개 모티프 + 연관 무드/색상
        sb.append("추천 모티프:\n");
        JsonNode motifs = styleData.path("associations").path("motifs");

        for (int i = 0; i < Math.min(5, topMotifs.size()); i++) {
            String motifName = topMotifs.get(i).name();
            sb.append("- ").append(motifName);

            JsonNode motifNode = motifs.path(motifName);

            // 연관 무드 top 2
            List<String> topMoods = new ArrayList<>();
            for (JsonNode m : motifNode.path("moods")) {
                if (topMoods.size() >= 2) break;
                topMoods.add(m.path("value").asText());
            }
            if (!topMoods.isEmpty()) {
                sb.append(" (무드: ").append(String.join(", ", topMoods)).append(")");
            }

            // 연관 색상 top 2
            List<String> topColors = new ArrayList<>();
            for (JsonNode c : motifNode.path("colors")) {
                if (topColors.size() >= 2) break;
                topColors.add(c.path("value").asText());
            }
            if (!topColors.isEmpty()) {
                sb.append(" (컬러: ").append(String.join(", ", topColors)).append(")");
            }

            sb.append("\n");
        }

        sb.append("\n");
        return sb.toString();
    }

    private String getCurrentSeason() {
        int month = LocalDate.now().getMonthValue();
        if (month == 12) return "christmas";
        // 10월을 "halloween"으로 보면 트렌드 힌트가 거미줄/유령/호박/박쥐 같은 핼러윈 소재로만 쏠려서
        // "요즘 유행하는 네일"을 물어도 핼러윈 맞춤 네일만 나왔다. 실제 계절(가을)로 본다.
        // (사용자가 계절로 "halloween"을 직접 고른 경우에는 buildTrendHint(userSeason)로 그대로 쓰인다)
        return switch (month) {
            case 3, 4, 5      -> "spring";
            case 6, 7, 8      -> "summer";
            case 9, 10, 11    -> "autumn";
            default            -> "winter";  // 1, 2월
        };
    }

    /**
     * associations.motifs 아래 각 모티프의 season[] 배열을 순회하여,
     * 현재 시즌과 일치하는 항목의 lift 값으로 점수를 계산하고 상위 limit개를 반환.
     * score = lift * 0.7 + log(count+1) * 0.3 (빈도가 너무 낮은 모티프 보정)
     */
    private List<MotifEntry> getTopMotifsBySeason(String season, int limit) {
        JsonNode motifs = styleData.path("associations").path("motifs");
        Map<String, Double> motifScores = new HashMap<>();

        Iterator<Map.Entry<String, JsonNode>> fields = motifs.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> entry = fields.next();
            String motifName = entry.getKey();
            JsonNode motifNode = entry.getValue();
            int motifCount = motifNode.path("count").asInt(0);

            for (JsonNode seasonEntry : motifNode.path("season")) {
                if (season.equals(seasonEntry.path("value").asText())) {
                    double lift = seasonEntry.path("lift").asDouble(0.0);
                    double score = lift * 0.7 + Math.log1p(motifCount) * 0.3;
                    motifScores.put(motifName, score);
                    break;
                }
            }
        }

        return motifScores.entrySet().stream()
                .sorted(Map.Entry.<String, Double>comparingByValue().reversed())
                .limit(limit)
                .map(e -> new MotifEntry(e.getKey(), e.getValue()))
                .collect(Collectors.toList());
    }

    private record MotifEntry(String name, double score) {}
}