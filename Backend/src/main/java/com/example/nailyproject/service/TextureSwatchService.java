package com.example.nailyproject.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.regex.Pattern;

/**
 * TextureExtractService가 추출한 {texture, color_hex} 쌍으로 스와치 이미지를 만든다.
 * 이미지는 백엔드 안에서 SwatchColorizer가 직접 만든다 (별도 서버/GPU/모델 없음):
 * 베이스 이미지 한 장에 hex 색을 입히고, mercury_chrome은 고정 이미지를 그대로 쓴다.
 * 스와치는 화면용이라 흰 배경 그대로 쓰고 배경 제거는 하지 않는다.
 *
 * 베이스 이미지가 없는 텍스처(ink, marble, drawing, 3d_charm)는 스와치를 만들지 않고 건너뛴다.
 */
@Service
@RequiredArgsConstructor
public class TextureSwatchService {

    private final SwatchColorizer swatchColorizer;

    private static final Pattern HEX = Pattern.compile("^#?[0-9a-fA-F]{6}$");

    /**
     * 텍스처+컬러 쌍 리스트로 스와치 이미지를 생성해 base64 맵으로 반환한다.
     *
     * @return { "syrup": "<PNG base64>", "chrome": "<PNG base64>", ... }  (미지원/실패 텍스처는 빠짐)
     */
    public Map<String, String> generateSwatches(List<Map<String, Object>> texturePairs) {
        Map<String, String> result = new LinkedHashMap<>();

        for (Map<String, Object> pair : texturePairs) {
            String texture = normalizeKey((String) pair.get("texture"));
            if (texture == null) continue;

            if (!swatchColorizer.supports(texture)) {
                System.out.println("[TextureSwatchService] " + texture + " — 스와치 베이스 이미지 없음, 건너뜀");
                continue;
            }
            if (result.containsKey(texture)) continue; // powder → chrome 통합 등으로 생긴 중복

            String colorHex = null;
            if (swatchColorizer.needsColor(texture)) {
                colorHex = normalizeHex(pair.get("color_hex"));
                if (colorHex == null) {
                    System.err.println("[TextureSwatchService] " + texture + " — color_hex 없음/형식 오류("
                            + pair.get("color_hex") + "), 건너뜀");
                    continue;
                }
            }

            try {
                result.put(texture, swatchColorizer.generate(texture, colorHex));
                System.out.println("[TextureSwatchService] " + texture + " 스와치 생성 완료");
            } catch (Exception e) {
                System.err.println("[TextureSwatchService] " + texture + " 실패: " + e.getMessage());
                // 하나 실패해도 나머지는 계속
            }
        }

        return result;
    }

    /** powder는 chrome과 합쳐졌다(같은 베이스). 저장 키도 chrome으로 통일한다. */
    private static String normalizeKey(String texture) {
        if (texture == null || texture.isBlank()) return null;
        String key = texture.trim();
        return "powder".equals(key) ? "chrome" : key;
    }

    /** "d9a3ab" / "#D9A3AB" → "#D9A3AB". 형식이 틀리면 null. */
    private static String normalizeHex(Object value) {
        if (value == null) return null;
        String s = String.valueOf(value).trim();
        if (!HEX.matcher(s).matches()) return null;
        return "#" + s.replace("#", "").toUpperCase();
    }
}
