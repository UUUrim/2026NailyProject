package com.example.nailyproject.service;

import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class SwatchColorizerTest {

    private final SwatchColorizer colorizer = new SwatchColorizer();

    private static BufferedImage decode(String base64) throws Exception {
        return ImageIO.read(new ByteArrayInputStream(Base64.getDecoder().decode(base64)));
    }

    @Test
    void outputIs1024x768WithWhiteBackground() throws Exception {
        for (String texture : List.of("plain_solid", "matte", "syrup", "glitter", "magnetic_chrome", "chrome", "knit")) {
            BufferedImage img = decode(colorizer.generate(texture, "#D9A3AB"));
            assertEquals(1024, img.getWidth(), texture);
            assertEquals(768, img.getHeight(), texture);
            assertEquals(0xFFFFFF, img.getRGB(50, 50) & 0xFFFFFF, texture + " 모서리는 순백이어야 한다");
        }
    }

    @Test
    void mercuryChromeIsFixedAsset() throws Exception {
        assertTrue(colorizer.supports("mercury_chrome"));
        assertFalse(colorizer.needsColor("mercury_chrome"));
        BufferedImage img = decode(colorizer.generate("mercury_chrome", null));
        assertEquals(1024, img.getWidth());
        assertEquals(768, img.getHeight());
    }

    @Test
    void rejectsUnknownTextureAndBadHex() {
        assertFalse(colorizer.supports("ink"));
        assertThrows(IllegalArgumentException.class, () -> colorizer.generate("ink", "#FFFFFF"));
        assertThrows(IllegalArgumentException.class, () -> colorizer.generate("syrup", "navy"));
        assertThrows(IllegalArgumentException.class, () -> colorizer.generate("syrup", null));
    }

    /**
     * 스와치 명세의 골든 이미지(port_kit/golden)와 8비트 값 차이 2 이내인지 확인한다.
     * 골든 폴더가 있을 때만 실행: SWATCH_GOLDEN_DIR=<...>/port_kit/golden
     */
    @Test
    void matchesGoldenImages() throws Exception {
        String dir = System.getenv("SWATCH_GOLDEN_DIR");
        assumeTrue(dir != null && new File(dir).isDirectory(), "SWATCH_GOLDEN_DIR 없음 — 골든 비교 건너뜀");

        Map<String, String> colors = Map.of("dusty_rose", "#D9A3AB", "navy", "#1F2D5C", "mint", "#9CDDC2");
        int worst = 0;
        int compared = 0;
        for (String texture : List.of("plain_solid", "matte", "syrup", "glitter", "magnetic_chrome", "chrome")) {
            for (Map.Entry<String, String> c : colors.entrySet()) {
                File golden = new File(dir, texture + "_" + c.getKey() + ".png");
                assertTrue(golden.exists(), golden.getPath());
                BufferedImage expected = ImageIO.read(golden);
                BufferedImage actual = decode(colorizer.generateReference(texture, c.getValue())); // 보정 없는 원본 수식

                int max = 0;
                for (int y = 0; y < 768; y++) {
                    for (int x = 0; x < 1024; x++) {
                        int e = expected.getRGB(x, y), a = actual.getRGB(x, y);
                        for (int shift = 0; shift <= 16; shift += 8) {
                            max = Math.max(max, Math.abs(((e >> shift) & 0xFF) - ((a >> shift) & 0xFF)));
                        }
                    }
                }
                System.out.println("[golden] " + texture + " " + c.getKey() + " maxDiff=" + max);
                assertTrue(max <= 2, texture + " " + c.getKey() + " 최대 차이 " + max);
                worst = Math.max(worst, max);
                compared++;
            }
        }
        assertEquals(18, compared);
        System.out.println("[golden] 18장 비교 완료, 최대 차이 " + worst);
    }
}
