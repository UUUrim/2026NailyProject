package com.example.nailyproject.service;

import com.example.nailyproject.entity.HandScan;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 스캔 서버가 만든 "양손 최종 measurements.json"(로컬 디스크)을 읽어서 화면/디자인 생성에 쓰는
 * 분석 값(피부톤, 추천 컬러, 추천 쉐입, 치수 ...)을 돌려준다.
 *
 * 파일 위치: {scan.results-dir}/{userId}/{왼손scanId}_{오른손scanId}/both/measurements.json
 * (scan/final_measurements.py가 두 손의 측정이 모이면 만든다)
 *
 * 파일이 아직 없으면(두 손이 안 끝났거나 예전 스캔) 빈 Optional/빈 값을 돌려준다.
 * 분석 값은 DB에 저장하지 않으므로 대체할 DB 값은 없다.
 */
@Service
public class ScanResultFileService {

    /** 손가락 하나의 화면용 데이터 - measurementsJson은 프론트가 JSON.parse하는 문자열 */
    public record FingerView(String finger, String measurementsJson, String size) {}

    /** 한 손(scanId) 기준으로 잘라낸 분석 값. 피부/컬러/쉐입/크기 판정은 양손 10개 기준 값이다. */
    public record ScanAnalysis(
            String skinToneHex,
            List<String> recommendedColors,
            String tone,
            Double warmness,
            Double brightness,
            Double saturation,
            String recommendedShape,
            String overallSize,
            Double avgLengthMm,
            Double avgWidthMm,
            Double avgCurveMm,
            // 손톱이 손가락 살 끝보다 평균 몇 mm 나와 있는지 (스캔 사진 기준). 이 값이 없던 예전 스캔은 null
            Double avgFreeEdgeMm,
            List<FingerView> fingers) {}

    /** 양손 최종 measurements.json 하나 = 스캔 한 번. 이력 목록의 한 줄이다. */
    public record SessionSummary(
            long leftScanId,
            long rightScanId,
            LocalDateTime scannedAt,
            String skinToneHex,
            List<String> recommendedColors,
            String tone,
            Double warmness,
            Double brightness,
            Double saturation,
            String recommendedShape,
            Double avgLengthMm,
            Double avgWidthMm,
            Double avgCurveMm,
            Double avgFreeEdgeMm) {}

    private record CachedFile(long lastModified, JsonNode root) {}

    private static final Pattern PAIR_DIR = Pattern.compile("^(\\d+)_(\\d+)$");

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Path resultsDir;
    private final Map<Path, CachedFile> cache = new ConcurrentHashMap<>();

    public ScanResultFileService(@Value("${scan.results-dir:../results}") String resultsDir) {
        this.resultsDir = Paths.get(resultsDir).toAbsolutePath().normalize();
    }

    @PostConstruct
    void logConfig() {
        System.out.println("[ScanResultFile] 스캔 결과 폴더: " + resultsDir
                + (Files.isDirectory(resultsDir) ? "" : "  (폴더가 아직 없음 - 스캔 후 생성되며, 그 전엔 DB 값을 사용)"));
    }

    // ── 조회 ────────────────────────────────────────────────────────────

    public Optional<ScanAnalysis> analysisFor(HandScan scan) {
        if (scan == null || scan.getId() == null || scan.getUser() == null) return Optional.empty();
        long userId = scan.getUser().getId();
        Long pairedId = scan.getPairedScanId();
        if (pairedId != null && scan.getHandSide() != null) {
            // 짝이 정해진 스캔: 그 짝의 파일만 읽는다 (다른 쌍의 파일이 더 최근이어도 쓰지 않는다).
            boolean isLeft = scan.getHandSide() == HandScan.HandSide.LEFT;
            long left = isLeft ? scan.getId() : pairedId;
            long right = isLeft ? pairedId : scan.getId();
            return readPairFile(userId, left, right).map(root -> toAnalysis(root, scan.getId()));
        }
        // 짝 정보가 없는 예전 스캔 - 이 scanId가 들어간 가장 최근 파일
        return analysis(userId, scan.getId());
    }

    private Optional<JsonNode> readPairFile(long userId, long leftScanId, long rightScanId) {
        Path file = resultsDir.resolve(String.valueOf(userId))
                .resolve(leftScanId + "_" + rightScanId).resolve("both").resolve("measurements.json");
        if (!Files.isRegularFile(file)) return Optional.empty();
        try {
            return read(file, Files.getLastModifiedTime(file).toMillis());
        } catch (IOException e) {
            System.err.println("[ScanResultFile] 파일 시각 조회 실패(" + file + "): " + e.getMessage());
            return Optional.empty();
        }
    }

    public Optional<ScanAnalysis> analysis(long userId, long scanId) {
        return findFile(userId, scanId).map(root -> toAnalysis(root, scanId));
    }

    /** 추천 컬러 hex 목록 - 최종 JSON의 값. 파일이 없으면 빈 리스트. */
    public List<String> recommendedColors(HandScan scan) {
        return analysisFor(scan).map(ScanAnalysis::recommendedColors).orElse(List.of());
    }

    /** 추천 쉐입 - 최종 JSON의 값. 파일이 없으면 null. */
    public String recommendedShape(HandScan scan) {
        return analysisFor(scan).map(ScanAnalysis::recommendedShape).orElse(null);
    }

    /**
     * 이 사용자의 양손 최종 measurements.json을 전부 읽어서 최신순 목록으로 돌려준다.
     * 이력 목록은 DB의 손 한쪽 기록을 시각으로 짝지어 만들지 않고, 이미 양손이 합쳐진 이 파일을 그대로 쓴다.
     */
    public List<SessionSummary> sessions(long userId) {
        Path userDir = resultsDir.resolve(String.valueOf(userId));
        List<SessionSummary> out = new ArrayList<>();
        if (!Files.isDirectory(userDir)) return out;
        try (DirectoryStream<Path> dirs = Files.newDirectoryStream(userDir)) {
            for (Path dir : dirs) {
                Matcher m = PAIR_DIR.matcher(dir.getFileName().toString());
                if (!m.matches()) continue;
                Path file = dir.resolve("both").resolve("measurements.json");
                if (!Files.isRegularFile(file)) continue;
                long modified = Files.getLastModifiedTime(file).toMillis();
                Optional<JsonNode> root = read(file, modified);
                if (root.isEmpty()) continue;
                out.add(toSession(Long.parseLong(m.group(1)), Long.parseLong(m.group(2)), root.get(), modified));
            }
        } catch (IOException e) {
            System.err.println("[ScanResultFile] 폴더 조회 실패: " + e.getMessage());
        }
        out.sort((a, b) -> b.scannedAt().compareTo(a.scannedAt()));
        return out;
    }

    private SessionSummary toSession(long left, long right, JsonNode root, long modifiedMillis) {
        ScanAnalysis a = toAnalysis(root, left);
        LocalDateTime at;
        try {
            at = LocalDateTime.parse(root.path("scannedAt").asText());
        } catch (RuntimeException e) {
            at = LocalDateTime.ofInstant(Instant.ofEpochMilli(modifiedMillis), ZoneId.systemDefault());
        }
        JsonNode summary = root.path("summary");
        // 손톱 끝 위치는 손마다 따로 잰 값이라 두 손 평균을 쓴다 (없으면 있는 쪽 값)
        Double l = number(root.path("left").path("summary"), "avg_free_edge_mm");
        Double r = number(root.path("right").path("summary"), "avg_free_edge_mm");
        Double freeEdge;
        if (l != null && r != null) freeEdge = (l + r) / 2.0;
        else freeEdge = l != null ? l : r;   // (삼항 한 줄로 쓰면 null인 Double이 double로 풀리며 NPE)
        return new SessionSummary(left, right, at,
                a.skinToneHex(), a.recommendedColors(), a.tone(), a.warmness(), a.brightness(), a.saturation(),
                a.recommendedShape(),
                number(summary, "avg_length_mm"), number(summary, "avg_width_mm"), number(summary, "avg_c_curve_mm"),
                freeEdge);
    }

    // ── 파일 찾기/읽기 ──────────────────────────────────────────────────

    /** 이 scanId가 왼손 또는 오른손으로 들어간 최종 JSON 중 가장 최근에 만들어진 것. */
    private Optional<JsonNode> findFile(long userId, long scanId) {
        Path userDir = resultsDir.resolve(String.valueOf(userId));
        if (!Files.isDirectory(userDir)) return Optional.empty();

        String id = String.valueOf(scanId);
        Path best = null;
        long bestTime = -1;
        try (DirectoryStream<Path> dirs = Files.newDirectoryStream(userDir)) {
            for (Path dir : dirs) {
                Matcher m = PAIR_DIR.matcher(dir.getFileName().toString());
                if (!m.matches() || !(m.group(1).equals(id) || m.group(2).equals(id))) continue;
                Path file = dir.resolve("both").resolve("measurements.json");
                if (!Files.isRegularFile(file)) continue;
                long modified = Files.getLastModifiedTime(file).toMillis();
                if (modified > bestTime) {
                    best = file;
                    bestTime = modified;
                }
            }
        } catch (IOException e) {
            System.err.println("[ScanResultFile] 폴더 조회 실패: " + e.getMessage());
            return Optional.empty();
        }
        return best == null ? Optional.empty() : read(best, bestTime);
    }

    private Optional<JsonNode> read(Path file, long lastModified) {
        CachedFile cached = cache.get(file);
        if (cached != null && cached.lastModified() == lastModified) return Optional.of(cached.root());
        try {
            JsonNode root = objectMapper.readTree(file.toFile());
            cache.put(file, new CachedFile(lastModified, root));
            return Optional.of(root);
        } catch (IOException e) {
            // 쓰는 도중이거나 깨진 파일 - 이번엔 DB 값으로 대체한다
            System.err.println("[ScanResultFile] 최종 measurements.json 읽기 실패(" + file + "): " + e.getMessage());
            return Optional.empty();
        }
    }

    // ── 변환 ────────────────────────────────────────────────────────────

    private ScanAnalysis toAnalysis(JsonNode root, long scanId) {
        boolean isLeft = String.valueOf(scanId).equals(root.path("leftSession").asText());
        JsonNode hand = root.path(isLeft ? "left" : "right");
        JsonNode skin = root.path("skin");
        JsonNode handSummary = hand.path("summary");

        List<String> colors = new ArrayList<>();
        for (JsonNode c : root.path("recommendedColors")) {
            if (c.isTextual() && !c.asText().isBlank()) colors.add(c.asText());
        }

        List<FingerView> fingers = new ArrayList<>();
        for (JsonNode f : hand.path("fingers")) {
            try {
                fingers.add(new FingerView(
                        f.path("finger").asText(),
                        objectMapper.writeValueAsString(f.path("measurements")),
                        f.path("size").asText("average")));
            } catch (IOException ignored) {
                // 손가락 하나가 깨져도 나머지는 보여준다
            }
        }

        return new ScanAnalysis(
                text(skin, "skinToneHex"),
                colors,
                text(skin, "tone"),
                number(skin, "warmness"),
                number(skin, "brightness"),
                number(skin, "saturation"),
                text(root, "recommendedShape"),
                text(root.path("summary"), "nail_size"),
                number(handSummary, "avg_length_mm"),
                number(handSummary, "avg_width_mm"),
                number(handSummary, "avg_c_curve_mm"),
                number(handSummary, "avg_free_edge_mm"),
                fingers);
    }

    private static String text(JsonNode node, String field) {
        JsonNode v = node.path(field);
        return v.isTextual() && !v.asText().isBlank() ? v.asText() : null;
    }

    private static Double number(JsonNode node, String field) {
        JsonNode v = node.path(field);
        return v.isNumber() ? v.asDouble() : null;
    }
}
