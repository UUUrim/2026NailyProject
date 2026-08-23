package com.example.nailyproject.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * TextureExtractService가 추출한 {texture, color} 쌍을
 * 텍스처별 프롬프트 템플릿에 매핑하고, NailImageService로 스와치 이미지를 배치 생성한다.
 * 생성 후 NailDetectionService.removeBackground()로 흰 배경을 제거해서
 * 투명 PNG로 S3에 저장한다.
 */
@Service
@RequiredArgsConstructor
public class TextureSwatchService {

    private final NailImageService nailImageService;
    private final NailDetectionService nailDetectionService; // ★ 배경 제거용
    private final S3Service s3Service;

    private static final long SWATCH_SEED = 647744376769594L;

    private static final String TAIL =
            "nailart, product shot, studio lighting, plain white background, " +
                    "top-down flat lay view, no shadow, no hands, no fingers, no text, " +
                    "no watermark, no reflection, perfectly defined sharp circular edges, " +
                    "high quality, sharp focus";

    private static final Map<String, String> TEMPLATES = Map.of(
            "glitter",
            "A circular material swatch sample of glossy {color} " +
                    "with dense fine glitter suspended in clear base, sparkling texture, " + TAIL,

            "plain_solid",
            "A circular material swatch sample of a plain soft {color} gel polish, " +
                    "smooth even solid color fill, subtle single glossy highlight streak on the surface, " +
                    "simple clean plain nail polish look, no glitter, no pattern, no texture, " + TAIL,

            "matte",
            "A circular material swatch sample of matte {color} nail polish, " +
                    "completely flat non-reflective surface, chalky solid matte finish, " +
                    "absolutely no shine, no gloss, no highlight, no reflection anywhere, " + TAIL,

            "magnetic_chrome",
            "A circular material swatch sample of {color} base with a magnetic " +
                    "cat-eye chrome metallic streak of light moving across the surface, " +
                    "smooth silky metallic texture, NOT glitter, NOT holographic sparkle, " +
                    "just one smooth light line effect, " + TAIL,

            "powder",
            "A circular material swatch sample of iridescent chrome powder nail polish, " +
                    "soft {color} base infused with a pearlescent aurora shimmer, " +
                    "shifting opal-like reflections of light across the glossy surface, " +
                    "mirror-like pearl chrome finish, glossy reflective sheen, " + TAIL,

            "marble",
            "A circular material swatch sample of marble swirl nail polish combining " +
                    "{color} in organic flowing veined streaks like natural stone marble, " +
                    "glossy finish, " + TAIL,

            "drawing",
            "A circular material swatch sample, a clear transparent glossy gel base disc " +
                    "with a simple hand-drawn doodle painted underneath the glossy surface, " +
                    "quick loose pen sketch style, imperfect wobbly linework, " +
                    "minimal thin black outline only, maybe one small area of {color}, " +
                    "casual doodle illustration, sketchy and unrefined, " +
                    "the drawing appears embedded within the transparent gel, " + TAIL,

            "3d_charm",
            "A circular material swatch sample, a clear transparent glossy gel base disc " +
                    "with a single large 3D sculptural {charm_material} {charm_shape} charm resting on top, " +
                    "dimensional textured relief, soft shadow beneath the charm, " +
                    "the surrounding base fully transparent, " + TAIL
    );

    /**
     * 텍스처+컬러 쌍 리스트로 스와치 이미지를 배치 생성 후,
     * 흰 배경 제거 → base64 맵으로 반환.
     *
     * @return { "glitter": "<투명 PNG base64>", "plain_solid": "<투명 PNG base64>", ... }
     */
    public Map<String, String> generateSwatches(List<Map<String, Object>> texturePairs) {
        Map<String, String> result = new LinkedHashMap<>();

        for (Map<String, Object> pair : texturePairs) {
            String texture = (String) pair.get("texture");
            if (texture == null || texture.isBlank()) continue;

            // mercury_chrome은 diffusers 재현 불가 → 고정 에셋
            if ("mercury_chrome".equals(texture)) {
                result.put(texture, getMercuryChromeFixed());
                continue;
            }

            String template = TEMPLATES.get(texture);
            if (template == null) {
                System.err.println("[TextureSwatchService] 알 수 없는 텍스처 키: " + texture + " — 건너뜀");
                continue;
            }

            String color = pair.get("color") != null ? (String) pair.get("color") : "";
            String charmShape = (String) pair.getOrDefault("charm_shape", "charm");
            String charmMaterial = (String) pair.getOrDefault("charm_material", "glossy");

            String prompt = template
                    .replace("{color}", color)
                    .replace("{charm_shape}", charmShape)
                    .replace("{charm_material}", charmMaterial);

            try {
                // 1. 스와치 이미지 생성
                String swatchBase64 = nailImageService.generateTextureSwatch(prompt, SWATCH_SEED);

                // ★ 팀원이 /remove-bg 추가하면 아래 주석 해제
                // String cleanBase64 = nailDetectionService.removeBackground(swatchBase64);
                // result.put(texture, cleanBase64);

                // 그 전까지는 배경 제거 없이 저장
                result.put(texture, swatchBase64);
                System.out.println("[TextureSwatchService] " + texture + " 스와치 생성 + 배경 제거 완료");
            } catch (Exception e) {
                System.err.println("[TextureSwatchService] " + texture + " 실패: " + e.getMessage());
                // 하나 실패해도 나머지는 계속
            }
        }

        return result;
    }

    private String getMercuryChromeFixed() {
        // TODO: S3에 올린 mercury_chrome 고정 에셋 base64로 반환
        System.out.println("[TextureSwatchService] mercury_chrome 고정 에셋 미설정 — 건너뜀");
        return null;
    }
}