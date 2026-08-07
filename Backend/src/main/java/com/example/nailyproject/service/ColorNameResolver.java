package com.example.nailyproject.service;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * hex 색상 코드를 사람이 읽는 영어 색상명으로 변환하는 유틸리티.
 * RGB 거리 계산으로 가장 가까운 이름을 코드가 결정론적으로 찾아준다.
 * API사용은 하지만 혹시 api가 작동하지 않을 시 백업코드용
 */
public class ColorNameResolver {

    private static final Map<String, String> NAMED_COLORS = new LinkedHashMap<>();

    static {
        NAMED_COLORS.put("#FFFFFF", "White");
        NAMED_COLORS.put("#F8F8F8", "Off White");
        NAMED_COLORS.put("#FFF8E7", "Ivory");
        NAMED_COLORS.put("#F5F0E6", "Cream");
        NAMED_COLORS.put("#F5E1D3", "Light Peach");
        NAMED_COLORS.put("#F2C2A0", "Peach");
        NAMED_COLORS.put("#F5EFE9", "Skin Beige");
        NAMED_COLORS.put("#D2B48C", "Beige");
        NAMED_COLORS.put("#E6D7C3", "Milk Tea Beige");
        NAMED_COLORS.put("#A0522D", "Terracotta");
        NAMED_COLORS.put("#8B4513", "Brown");
        NAMED_COLORS.put("#5C3A21", "Dark Brown");
        NAMED_COLORS.put("#D2691E", "Burnt Orange");
        NAMED_COLORS.put("#FFA500", "Orange");
        NAMED_COLORS.put("#FFD700", "Gold");
        NAMED_COLORS.put("#F0E68C", "Khaki");
        NAMED_COLORS.put("#FFFACD", "Pale Yellow");
        NAMED_COLORS.put("#FFFF00", "Yellow");
        NAMED_COLORS.put("#FFD1DC", "Pastel Pink");
        NAMED_COLORS.put("#FFC0CB", "Pink");
        NAMED_COLORS.put("#FFB6C1", "Light Pink");
        NAMED_COLORS.put("#FF69B4", "Hot Pink");
        NAMED_COLORS.put("#DE869F", "Rose Pink");
        NAMED_COLORS.put("#C71585", "Deep Rose");
        NAMED_COLORS.put("#FF0000", "Red");
        NAMED_COLORS.put("#B22222", "Deep Red");
        NAMED_COLORS.put("#DC143C", "Crimson");
        NAMED_COLORS.put("#E6E6FA", "Lavender");
        NAMED_COLORS.put("#D8BFD8", "Thistle Purple");
        NAMED_COLORS.put("#9370DB", "Lavender Purple");
        NAMED_COLORS.put("#800080", "Purple");
        NAMED_COLORS.put("#4B0082", "Deep Purple");
        NAMED_COLORS.put("#ADFF2F", "Lime Green");
        NAMED_COLORS.put("#98FB98", "Pale Green");
        NAMED_COLORS.put("#90EE90", "Mint Green");
        NAMED_COLORS.put("#3CB371", "Sage Green");
        NAMED_COLORS.put("#228B22", "Forest Green");
        NAMED_COLORS.put("#008080", "Teal");
        NAMED_COLORS.put("#40E0D0", "Turquoise");
        NAMED_COLORS.put("#E0FFFF", "Ice Blue");
        NAMED_COLORS.put("#87CEEB", "Sky Blue");
        NAMED_COLORS.put("#4682B4", "Steel Blue");
        NAMED_COLORS.put("#4169E1", "Royal Blue");
        NAMED_COLORS.put("#00008B", "Deep Ocean Blue");
        NAMED_COLORS.put("#000080", "Navy");
        NAMED_COLORS.put("#C0C0C0", "Silver");
        NAMED_COLORS.put("#A9A9A9", "Gray");
        NAMED_COLORS.put("#696969", "Charcoal Gray");
        NAMED_COLORS.put("#000000", "Black");
    }

    /**
     * 주어진 hex 색상과 가장 가까운(perceptual) 이름을 반환한다.
     * 파싱 실패 시 원본 hex 문자열을 그대로 반환한다.
     */
    public static String nearestColorName(String hex) {
        int[] target = hexToRgb(hex);
        if (target == null) return hex;

        String bestName = hex;
        double bestDist = Double.MAX_VALUE;

        for (Map.Entry<String, String> entry : NAMED_COLORS.entrySet()) {
            int[] candidate = hexToRgb(entry.getKey());
            if (candidate == null) continue;
            double dist = weightedDistance(target, candidate);
            if (dist < bestDist) {
                bestDist = dist;
                bestName = entry.getValue();
            }
        }
        return bestName;
    }

    private static int[] hexToRgb(String hex) {
        if (hex == null) return null;
        try {
            String h = hex.trim().replace("#", "");
            if (h.length() == 3) {
                h = "" + h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
            }
            if (h.length() != 6) return null;
            int r = Integer.parseInt(h.substring(0, 2), 16);
            int g = Integer.parseInt(h.substring(2, 4), 16);
            int b = Integer.parseInt(h.substring(4, 6), 16);
            return new int[]{r, g, b};
        } catch (Exception e) {
            return null;
        }
    }

    // 사람 눈이 초록에 더 민감하다는 걸 반영한 가중치 유클리드 거리 (redmean 근사)
    private static double weightedDistance(int[] a, int[] b) {
        double dr = a[0] - b[0];
        double dg = a[1] - b[1];
        double db = a[2] - b[2];
        return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
    }
}
