package com.example.nailyproject.service;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * hex 색상을 이미지 생성 프롬프트용 영어 색상 단어("pale pink", "dusty rose" ...)로 변환한다.
 *
 * 외부 API(api.color.pizza)와 LLM 변환을 쓰지 않고, 코드가 결정론적으로 결정한다.
 *   1) EXACT 표에 있는 헥스  → 표의 단어를 그대로 사용
 *   2) 표에 없는 헥스        → ANCHORS 중 가장 가까운(CIELAB 거리) 색의 단어를 사용
 *
 * 색 단어가 마음에 들지 않으면 아래 EXACT / ANCHORS 표만 고치면 된다.
 * modifier 사전: pale/light = 아주 밝음, milky = 뿌옇게 탁한 우윳빛, muted/dusty = 회색기가 섞임,
 *               deep = 어두움, vivid = 채도가 강하고 선명함
 */
@Service
public class ColorNameService {

    private record Anchor(String words, double l, double a, double b) {}

    /** 앱 추천 팔레트에서 자주 쓰이는 색 — 정확히 일치하면 무조건 이 단어. */
    private static final Map<String, String> EXACT = new LinkedHashMap<>();
    /** 표에 없는 헥스가 들어왔을 때 가장 가까운 색을 찾기 위한 기준 색 목록. */
    private static final List<Anchor> ANCHORS = new ArrayList<>();

    static {
        // ── 정확 매칭 표 ────────────────────────────────────────────────
        exact("FDE2EA", "pale pink");
        exact("FFC0D0", "light pink");
        exact("FF90B3", "vivid pink");
        exact("DE869F", "dusty rose");
        exact("A98BFF", "light lavender");
        exact("7CD6D6", "light mint");
        exact("FFF2A8", "pale yellow");
        exact("E6E6E6", "light gray");

        // ── 근접 매칭용 기준 색 (표에 없는 헥스 → 가장 가까운 것) ──────────
        // neutral
        anchor("FFFFFF", "white");
        anchor("FFF8E7", "ivory");
        anchor("F5EEDC", "cream");
        anchor("9E9E9E", "gray");
        anchor("4A4A4A", "deep gray");
        anchor("111111", "black");
        // pink / rose / red
        anchor("D8A7B1", "dusty pink");
        anchor("E0607E", "rose");
        anchor("A8324F", "deep rose");
        anchor("D81B60", "deep pink");
        anchor("E0218A", "vivid magenta");
        anchor("D32F2F", "red");
        anchor("FF1F1F", "vivid red");
        anchor("7B1E2B", "deep red");
        // peach / coral / orange
        anchor("FFE8DC", "pale peach");
        anchor("FFD3B6", "peach");
        anchor("FF7F6B", "coral");
        anchor("D98A7C", "muted coral");
        anchor("FF8C1A", "orange");
        anchor("FF6A00", "vivid orange");
        anchor("B8500F", "deep orange");
        // yellow / beige / brown
        anchor("FFD93D", "yellow");
        anchor("FFE600", "vivid yellow");
        anchor("FFD700", "gold");
        anchor("D8C070", "muted yellow");
        anchor("B8931A", "deep yellow");
        anchor("F5EFE9", "milky beige");   // 스킨톤 계열 (light gray로 잘못 붙는 것 방지)
        anchor("F3E7D3", "light beige");
        anchor("E8D5B7", "beige");
        anchor("B98B6B", "light brown");
        anchor("8B5A3C", "brown");
        anchor("4A2C1D", "deep brown");
        // green / mint / teal
        anchor("DFF2D8", "pale green");
        anchor("A8DDA0", "light green");
        anchor("3FA55B", "green");
        anchor("17C24A", "vivid green");
        anchor("8FA98F", "muted green");
        anchor("1E5B36", "deep green");
        anchor("7A7A2E", "olive green");
        anchor("4B4F1C", "deep olive green");
        anchor("D5F3E8", "pale mint");
        anchor("98E0C0", "mint");
        anchor("1E8A8A", "teal");
        anchor("0F5257", "deep teal");
        // blue
        anchor("DCEBFA", "pale blue");
        anchor("A8CCF0", "light blue");
        anchor("3B7DD8", "blue");
        anchor("1E5BFF", "vivid blue");
        anchor("7D93B5", "muted blue");
        anchor("1B3A80", "deep blue");
        anchor("1A2550", "navy");
        // purple / lavender
        anchor("ECE6FA", "pale lavender");
        anchor("B9A2E6", "lavender");
        anchor("B3A6C9", "muted lavender");
        anchor("C6A6E6", "light purple");
        anchor("8E44AD", "purple");
        anchor("8A2BE2", "vivid purple");
        anchor("4B2A7B", "deep purple");
    }

    private static void exact(String hex, String words) {
        EXACT.put(hex.toLowerCase(), words);
        anchor(hex, words);
    }

    private static void anchor(String hex, String words) {
        int rgb = Integer.parseInt(hex, 16);
        double[] lab = toLab((rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF);
        ANCHORS.add(new Anchor(words, lab[0], lab[1], lab[2]));
    }

    // ─────────────────────────────────────────────────────────────────────
    // public API (기존 시그니처 유지)
    // ─────────────────────────────────────────────────────────────────────

    /** hex 하나를 색상 단어로 변환. hex 형식이 아니면 입력을 그대로(trim) 돌려준다. */
    public String resolveColorName(String hex) {
        String n = normalize(hex);
        if (n == null) return hex == null ? null : hex.trim();
        String exact = EXACT.get(n);
        if (exact != null) return exact;
        return nearest(n);
    }

    /** 여러 hex를 같은 순서로 변환. null/빈 값은 건너뛴다. */
    public List<String> resolveColorNames(List<String> hexes) {
        List<String> result = new ArrayList<>();
        if (hexes == null) return result;
        for (String h : hexes) {
            if (h == null || h.isBlank()) continue;
            result.add(resolveColorName(h));
        }
        return result;
    }

    /** "#RRGGBB" / "RRGGBB" / "#RGB" 형태인지 */
    public static boolean isHex(String value) {
        return normalize(value) != null;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 내부
    // ─────────────────────────────────────────────────────────────────────

    /** 유효한 hex면 소문자 6자리(# 없음), 아니면 null */
    private static String normalize(String hex) {
        if (hex == null) return null;
        String h = hex.trim().replace("#", "").toLowerCase();
        if (h.length() == 3) {
            h = "" + h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
        }
        return h.matches("[0-9a-f]{6}") ? h : null;
    }

    private static String nearest(String normalizedHex) {
        int rgb = Integer.parseInt(normalizedHex, 16);
        double[] t = toLab((rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF);
        String best = normalizedHex;
        double bestDist = Double.MAX_VALUE;
        for (Anchor an : ANCHORS) {
            double dl = t[0] - an.l(), da = t[1] - an.a(), db = t[2] - an.b();
            double d = dl * dl + da * da + db * db;
            if (d < bestDist) {
                bestDist = d;
                best = an.words();
            }
        }
        return best;
    }

    private static double[] toLab(int r, int g, int b) {
        double rl = linear(r / 255.0), gl = linear(g / 255.0), bl = linear(b / 255.0);
        double x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047;
        double y = (0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl);
        double z = (0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl) / 1.08883;
        double fx = labF(x), fy = labF(y), fz = labF(z);
        return new double[]{116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)};
    }

    private static double linear(double c) {
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    private static double labF(double t) {
        return t > 216.0 / 24389.0 ? Math.cbrt(t) : (24389.0 / 27.0 * t + 16.0) / 116.0;
    }
}