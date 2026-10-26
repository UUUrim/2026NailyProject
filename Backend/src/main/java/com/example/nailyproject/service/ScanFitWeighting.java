package com.example.nailyproject.service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 손 스캔 값(쉐입 추천, 손톱 크기, 피부 밝기, 추천 팔레트)을 "잘 어울리는 색/디자인/무드" 가중치로 바꾼다.
 * 완전 무작위로 뽑던 추천 컬러 선택, 디자인 채우기, 기본 무드를 규칙을 어기지 않는 선에서 어울리는 쪽으로 기울이는 용도다.
 *
 * 근거는 웹 조사(미용 매거진/블로그, 신뢰도 중간~낮음)와 일반적인 네일 업계 통념이다. 모두 "가중치/힌트"이며
 * 사용자가 직접 고른 값은 항상 우선한다.
 */
final class ScanFitWeighting {

    enum NailBody { WIDE, AVERAGE, NARROW }

    enum HandSize { SMALL, AVERAGE, LARGE }

    enum Tone { VIVID, DARK, PASTEL, MUTED }

    /** 스캔에서 읽은 손 특성. 없는 값은 null. */
    record Fit(NailBody body, HandSize size, Double skinBrightness) {
        static final Fit NONE = new Fit(null, null, null);
    }

    private static final Pattern BODY_LINE = Pattern.compile("nail body: (wide|average|narrow)");
    private static final Pattern SIZE_LINE = Pattern.compile("nail size: (small|average|large)");
    private static final Pattern HEX = Pattern.compile("#[0-9A-Fa-f]{6}");

    private ScanFitWeighting() {}

    /**
     * 스캔의 쉐입 추천(scan/nail_measurer.py recommend_nail_shape)과 같은 축으로 판단한다. 그 함수는 손가락별
     * 폭/길이 비율을 모집단 기준(Jung et al. 2015)과 비교한 z값 평균으로 쉐입을 정한다
     * (z가 클수록 넓고 짧은 손톱: stiletto >= 1.25, ballerina >= 0.75, almond >= 0.25, oval >= -0.25, square >= -0.75, 그 아래 round).
     * 그래서 별도 임계값을 새로 만들지 않고 추천 결과를 그대로 읽는다: stiletto/ballerina = 폭이 넓은 베드(WIDE),
     * almond/oval = 보통, square/round = 폭이 좁은 편(NARROW). 추천 쉐입이 없으면 null.
     *
     * 주의: 이 값은 "손톱이 짧다/길다"가 아니라 "베드가 넓다"로만 쓴다. 짧은 손톱은 쉐입 추천에서 길고 뾰족한 쉐입(발레리나/스틸레토)
     * 으로 보강되고, 출력 팁은 그 길이로 만들어져서 생성 이미지는 이미 긴 손톱이다. 그래서 "짧은 손톱 전용 디자인"
     * (작은 장식, 가는 프렌치 등)은 쓰지 않는다. 길이와 무관하게 남는 건 폭(베드 넓이)이 주는 인상뿐이다.
     */
    static NailBody nailBodyFromShape(String recommendedShape) {
        if (recommendedShape == null) return null;
        return switch (recommendedShape.trim().toLowerCase()) {
            case "stiletto", "ballerina" -> NailBody.WIDE;
            case "almond", "oval" -> NailBody.AVERAGE;
            case "square", "round" -> NailBody.NARROW;
            default -> null;
        };
    }

    /** 스캔 summary.nail_size(much_smaller / smaller / average / larger / much_larger)를 3단계로. */
    static HandSize handSizeFrom(String nailSize) {
        if (nailSize == null || nailSize.isBlank()) return null;
        String s = nailSize.trim().toLowerCase();
        if (s.contains("smaller")) return HandSize.SMALL;
        if (s.contains("larger")) return HandSize.LARGE;
        return HandSize.AVERAGE;
    }

    // ---- 플래너 입력 한 줄(FingerDesignPlanService가 같은 줄을 다시 읽는다) ----

    static String fitLine(Fit fit) {
        if (fit == null || (fit.body() == null && fit.size() == null)) return "";
        StringBuilder sb = new StringBuilder("[HAND FIT]");
        if (fit.body() != null) sb.append(" nail body: ").append(fit.body().name().toLowerCase()).append(';');
        if (fit.size() != null) sb.append(" nail size: ").append(fit.size().name().toLowerCase()).append(';');
        return sb.append('\n').toString();
    }

    static Fit fitFromInput(String input) {
        if (input == null) return Fit.NONE;
        Matcher b = BODY_LINE.matcher(input);
        Matcher s = SIZE_LINE.matcher(input);
        return new Fit(b.find() ? NailBody.valueOf(b.group(1).toUpperCase()) : null,
                s.find() ? HandSize.valueOf(s.group(1).toUpperCase()) : null, null);
    }

    static List<String> hexesIn(String input) {
        List<String> out = new ArrayList<>();
        if (input == null) return out;
        Matcher m = HEX.matcher(input);
        while (m.find()) {
            String h = m.group().toUpperCase();
            if (!out.contains(h)) out.add(h);
        }
        return out;
    }

    // ---- 색 분류 ----

    /** {h(0~360), s(0~1), l(0~1)} */
    private static double[] hsl(String hex) {
        String h = hex.trim().replace("#", "");
        double r = Integer.parseInt(h.substring(0, 2), 16) / 255.0;
        double g = Integer.parseInt(h.substring(2, 4), 16) / 255.0;
        double b = Integer.parseInt(h.substring(4, 6), 16) / 255.0;
        double max = Math.max(r, Math.max(g, b)), min = Math.min(r, Math.min(g, b));
        double l = (max + min) / 2, s = 0, hue = 0;
        double d = max - min;
        if (d > 1e-9) {
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max == r) hue = ((g - b) / d + (g < b ? 6 : 0));
            else if (max == g) hue = (b - r) / d + 2;
            else hue = (r - g) / d + 4;
            hue *= 60;
        }
        return new double[]{hue, s, l};
    }

    static Tone tone(String hex) {
        try {
            double[] c = hsl(hex);
            double s = c[1], l = c[2];
            if (l < 0.30) return Tone.DARK;
            if (l >= 0.78 || (s < 0.40 && l >= 0.68)) return Tone.PASTEL;
            if (s >= 0.50 && l >= 0.35 && l <= 0.75) return Tone.VIVID;
            return Tone.MUTED;
        } catch (Exception e) {
            return Tone.MUTED;
        }
    }

    // ---- 색 가중치 선택 ----

    private static double colorWeight(String hex, Fit fit) {
        Tone t = tone(hex);
        double w = 1.0;
        // 손톱/손이 큰 편이면 연한 색은 더 넓어 보이고 짙은 색은 작아 보인다(밝은 색이 팽창해 보인다는 통념).
        if (fit.size() == HandSize.LARGE) {
            w *= switch (t) {
                case DARK -> 1.3;
                case PASTEL -> 0.8;
                default -> 1.0;
            };
        }
        // 어두운 피부톤에서는 연한 파스텔이 묻혀 보이고 보석톤/비비드가 살아난다.
        if (fit.skinBrightness() != null && fit.skinBrightness() < 0.55) {
            w *= switch (t) {
                case PASTEL -> 0.6;
                case VIVID, DARK -> 1.3;
                default -> 1.0;
            };
        }
        return w;
    }

    private static double hueDistance(double a, double b) {
        double d = Math.abs(a - b) % 360;
        return d > 180 ? 360 - d : d;
    }

    /** 이미 고른 색과 같은 계열(유사색)이거나 무채색이면 조화롭게 보고 가중치를 올리고, 정반대 색이면 낮춘다. */
    private static double harmony(String candidate, List<String> chosen) {
        if (chosen.isEmpty()) return 1.0;
        double[] c = hsl(candidate);
        double factor = 1.0;
        for (String other : chosen) {
            double[] o = hsl(other);
            if (c[1] < 0.2 || o[1] < 0.2) { factor *= 1.3; continue; }
            double d = hueDistance(c[0], o[0]);
            if (d <= 45) factor *= 1.6;
            else if (d >= 150) factor *= 0.5;
        }
        return factor;
    }

    /** 팔레트에서 가중치로 count개를 중복 없이 뽑는다. */
    static List<String> pickWeighted(List<String> palette, Fit fit, int count, Random rnd) {
        Fit f = fit == null ? Fit.NONE : fit;
        List<String> pool = new ArrayList<>(palette);
        List<String> chosen = new ArrayList<>();
        while (chosen.size() < count && !pool.isEmpty()) {
            double[] w = new double[pool.size()];
            double total = 0;
            for (int i = 0; i < w.length; i++) {
                try {
                    w[i] = colorWeight(pool.get(i), f) * harmony(pool.get(i), chosen);
                } catch (Exception e) {
                    w[i] = 1.0;
                }
                total += w[i];
            }
            double x = rnd.nextDouble() * total;
            int idx = w.length - 1;
            for (int i = 0; i < w.length; i++) {
                x -= w[i];
                if (x <= 0) { idx = i; break; }
            }
            chosen.add(pool.remove(idx));
        }
        return chosen;
    }

    // ---- 디자인 가중치 ----

    /**
     * 색 톤과 손 특성에 따른 디자인 배수. 키는 FingerDesignPlanService의 디자인 이름
     * (one-color, gradient, glitter, marble, french, cheek, powder, magnetic)이다.
     */
    static Map<String, Double> designMultipliers(List<String> hexes, Fit fit) {
        Fit f = fit == null ? Fit.NONE : fit;
        Map<String, Double> m = new HashMap<>();
        int vivid = 0, dark = 0, pastel = 0;
        for (String h : hexes) {
            switch (tone(h)) {
                case VIVID -> vivid++;
                case DARK -> dark++;
                case PASTEL -> pastel++;
                default -> { }
            }
        }
        int n = Math.max(1, hexes.size());
        double vividShare = (double) vivid / n, darkShare = (double) dark / n, pastelShare = (double) pastel / n;
        // 진한/비비드: 단색이나 컬러 프렌치처럼 색 자체가 보이는 디자인. 부드러운 번짐은 색이 탁해질 수 있어 낮춘다.
        mul(m, "one-color", 1 + vividShare);
        mul(m, "french", 1 + 0.5 * vividShare);
        mul(m, "gradient", 1 - 0.3 * vividShare);
        // 파스텔: 소프트 그라데이션, 치크, 프렌치, 글리터
        mul(m, "gradient", 1 + pastelShare);
        mul(m, "cheek", 1 + pastelShare);
        mul(m, "french", 1 + 0.5 * pastelShare);
        mul(m, "glitter", 1 + 0.5 * pastelShare);
        // 짙은 색: 빛이 도는 질감(자석, 글리터, 마블)이 잘 산다. 치크는 짙은 바탕에서 탁해진다.
        mul(m, "magnetic", 1 + 1.0 * darkShare);
        mul(m, "glitter", 1 + 0.5 * darkShare);
        mul(m, "marble", 1 + 0.5 * darkShare);
        mul(m, "cheek", 1 - 0.5 * darkShare);
        mul(m, "gradient", 1 - 0.2 * darkShare);
        // 폭이 넓은 베드(길이는 쉐입이 이미 보강하므로 길이 얘기는 하지 않는다): 그라데이션은 시선을 폭에서 멀어지게 하고,
        // 글리터/펄 광택은 손톱을 더 넓어 보이게 한다는 통념이 있다.
        if (f.body() == NailBody.WIDE) {
            mul(m, "gradient", 1.15);
            mul(m, "glitter", 0.85);
        }
        // 크고 넓은 손/손톱: 촘촘한 장식보다 단순하고 깔끔한 면(원컬러, 마블)이 낫다고 한다.
        if (f.size() == HandSize.LARGE) {
            mul(m, "one-color", 1.2);
            mul(m, "marble", 1.2);
        }
        return m;
    }

    private static void mul(Map<String, Double> m, String key, double factor) {
        m.merge(key, factor, (a, b) -> a * b);
    }

    /** 가중치 샘플링 순서로 정렬한 새 리스트(중복 항목은 가중치 합으로 취급). */
    static List<String> weightedOrder(List<String> items, Map<String, Double> weights, Random rnd) {
        List<String> pool = new ArrayList<>(items);
        List<String> out = new ArrayList<>();
        while (!pool.isEmpty()) {
            double total = 0;
            for (String it : pool) total += Math.max(0.05, weights.getOrDefault(it, 1.0));
            double x = rnd.nextDouble() * total;
            int idx = pool.size() - 1;
            for (int i = 0; i < pool.size(); i++) {
                x -= Math.max(0.05, weights.getOrDefault(pool.get(i), 1.0));
                if (x <= 0) { idx = i; break; }
            }
            out.add(pool.remove(idx));
        }
        return out;
    }

    // ---- 쉐입 -> 무드 ----

    /**
     * 쉐입이 주는 인상에 맞는 무드 가중치. 앞서 정한 무드 -> 쉐입 규칙(러블리/우아: 아몬드·오벌·발레리나, 시크/펑키:
     * 스틸레토·스퀘어, 심플/모던: 스퀘어·라운드, 소프트/큐트: 라운드·오벌)과 같은 방향으로 거꾸로 읽은 것이다.
     */
    private static final Map<String, Map<String, Double>> MOOD_BY_SHAPE = Map.of(
            "round", moods("cute", 3, "pure", 3, "simple", 2, "lovely", 1, "delicate", 1, "modern", 1),
            "oval", moods("feminine", 3, "elegant", 2, "delicate", 2, "lovely", 2, "pure", 2, "cute", 1),
            "almond", moods("elegant", 3, "feminine", 3, "lovely", 3, "delicate", 2),
            "ballerina", moods("lovely", 3, "feminine", 2, "elegant", 2, "chic", 1),
            "square", moods("chic", 3, "modern", 3, "simple", 2, "elegant", 1, "funky", 1),
            "stiletto", moods("chic", 3, "funky", 2, "modern", 1));

    private static Map<String, Double> moods(Object... kv) {
        Map<String, Double> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], ((Number) kv[i + 1]).doubleValue());
        return m;
    }

    /** 쉐입 + 색 톤으로 무드 하나를 가중치로 고른다. 쉐입을 모르면 null(호출한 쪽이 기존 무작위로 넘어간다). */
    static String pickMood(String shape, List<String> hexes, Random rnd) {
        if (shape == null) return null;
        Map<String, Double> base = MOOD_BY_SHAPE.get(shape.trim().toLowerCase());
        if (base == null) return null;
        Map<String, Double> w = new LinkedHashMap<>(base);
        int vivid = 0, dark = 0, pastel = 0;
        for (String h : hexes) {
            switch (tone(h)) {
                case VIVID -> vivid++;
                case DARK -> dark++;
                case PASTEL -> pastel++;
                default -> { }
            }
        }
        int n = Math.max(1, hexes.size());
        double vividShare = (double) vivid / n, darkShare = (double) dark / n, pastelShare = (double) pastel / n;
        for (String mood : List.of("lovely", "pure", "cute", "delicate")) mulIf(w, mood, 1 + 0.5 * pastelShare);
        for (String mood : List.of("chic", "modern", "elegant")) mulIf(w, mood, 1 + 0.5 * darkShare);
        for (String mood : List.of("cute", "funky")) mulIf(w, mood, 1 + 0.5 * vividShare);
        double total = w.values().stream().mapToDouble(Double::doubleValue).sum();
        double x = rnd.nextDouble() * total;
        String last = null;
        for (Map.Entry<String, Double> e : w.entrySet()) {
            last = e.getKey();
            x -= e.getValue();
            if (x <= 0) return e.getKey();
        }
        return last;
    }

    private static void mulIf(Map<String, Double> w, String key, double factor) {
        if (w.containsKey(key)) w.put(key, w.get(key) * factor);
    }

    /** scan-auto 요약용: 이 쉐입에 어울리는 무드 후보(가중치 높은 순). GPT가 무드를 직접 고르는 흐름에서 쓴다. */
    static String moodLean(String shape) {
        if (shape == null) return "";
        Map<String, Double> base = MOOD_BY_SHAPE.get(shape.trim().toLowerCase());
        if (base == null) return "";
        List<String> top = base.entrySet().stream()
                .sorted((a, b) -> Double.compare(b.getValue(), a.getValue()))
                .limit(4).map(Map.Entry::getKey).toList();
        return "- A " + shape.trim().toLowerCase() + " nail reads as " + String.join(" / ", top)
                + ": pick the mood from these unless the chosen colors clearly point somewhere else.\n";
    }

    // ---- scan-auto 자연어 힌트 ----

    /** GPT가 디자인을 직접 고르는 흐름(scan-auto)에 넣는 짧은 힌트. 규칙을 덮어쓰지 않는다. */
    static String autoHint(Fit fit, String shape) {
        Fit f = fit == null ? Fit.NONE : fit;
        StringBuilder sb = new StringBuilder("[HAND FIT - soft guidance, never overrides the rules]\n");
        sb.append(moodLean(shape));
        if (f.body() == NailBody.WIDE) {
            sb.append("- This person's nail beds are wide, and the nails are being extended into a long tapered shape, so")
                    .append(" treat them as long nails with a generous canvas (long french tips, full-length gradients and")
                    .append(" vertical art all work), not as short nails. Only the width needs care: favor vertical or")
                    .append(" lengthwise elements, soft gradients and a clean center line; avoid wide horizontal bands, chunky")
                    .append(" decoration and heavy glitter that make the nail look wider. Optional: a thin vertical line down")
                    .append(" the middle, or a thin clear gap along the side walls.\n");
        }
        if (f.size() == HandSize.SMALL) {
            sb.append("- Small hands: scale everything down. Use tiny charms, tiny dots or flowers on one or two accent")
                    .append(" nails, and avoid big bulky pieces.\n");
        } else if (f.size() == HandSize.LARGE) {
            sb.append("- Large hands: keep patterns simple and clean (one-color, marble, clean lines); avoid many tiny")
                    .append(" intricate details. Medium and deeper tones look slimmer than very pale ones.\n");
        }
        if (f.skinBrightness() != null && f.skinBrightness() < 0.55) {
            sb.append("- Deeper skin tone: jewel tones, saturated brights and rich deep colors look best; very pale")
                    .append(" pastels can disappear against the skin, so give pastel nails a syrup, glossy or shimmer depth.\n");
        }
        sb.append("- Match the design to the colors: pastel colors suit soft gradients, cheek blush and french tips; vivid")
                .append(" colors suit one-color or color-tip designs; deep dark colors suit magnetic, glitter or marble,")
                .append(" not a cheek blush.\n");
        return sb.toString();
    }
}
