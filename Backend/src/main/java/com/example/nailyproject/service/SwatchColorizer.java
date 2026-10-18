package com.example.nailyproject.service;

import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 스와치를 백엔드 안에서 직접 만든다 (별도 서버/GPU/모델 없음).
 * resources/swatch/ 의 흑백 베이스 이미지 한 장에 hex 색만 입혀서 1024x768 PNG(흰 배경, 지름 657 원)로 반환한다.
 *
 * 수식 (스와치 명세 4장, 픽셀마다):
 *   d   = L(베이스)/255 - median               (베이스 밝기의 편차, 세 채널 공통)
 *   c   = clamp(t + gain*d, 0, 1)              t = 목표색(0~1), 채널별
 *   c   = max(c, t*shadowFloor)
 *   s   = clamp((d - specStart)/specRange, 0, 1)
 *   c   = c + (1-c)*s                          밝은 하이라이트는 흰색으로
 *   out = c*alpha + (1-alpha)                  흰 배경 위에 합성 (alpha = 스와치 원 마스크)
 *   pixel = floor(clamp(out,0,1)*255)
 * median/alpha는 베이스 이미지만으로 결정되는 값이라 미리 계산된 상수(median)와 마스크 이미지(masks/*)를 쓴다.
 *
 * mercury_chrome은 색이 없는 고정 이미지(swatch/mercury_chrome.png)를 그대로 반환한다.
 */
@Service
public class SwatchColorizer {

    private static final int W = 1024;
    private static final int H = 768;

    private record Spec(float median, float gain, float shadowFloor, float specStart, float specRange) {}

    // port_kit/manifest.json 의 textures.<key>.median / params
    private static final Map<String, Spec> SPECS = Map.of(
            "plain_solid",     new Spec(0.713726f, 1.6f, 0.0f, 0.12f, 0.08f),
            // 매트: 입체감은 유지하되 가장자리가 검게 떨어지지 않게, 정반사 하이라이트는 만들지 않는다
            "matte",           new Spec(0.639216f, 1.0f, 0.5f, 2.0f, 0.08f),
            "syrup",           new Spec(0.572549f, 1.6f, 0.0f, 0.12f, 0.08f),
            "magnetic_chrome", new Spec(0.803922f, 1.6f, 0.0f, 0.12f, 0.08f),
            "chrome",          new Spec(0.811765f, 1.6f, 0.0f, 0.12f, 0.08f),
            // 글리터: 큰 육각 조각이 어두운 점으로 남지 않게 어두운 쪽 하한을 둔다
            "glitter",         new Spec(0.784314f, 1.6f, 0.8f, 0.12f, 0.08f),
            // 니트(벨벳): 섬유 조각 질감이 옅어서 명암 편차를 크게 반영하고(gain 3.0) 어두운 쪽 하한을 둔다
            "knit",            new Spec(0.764706f, 3.0f, 0.6f, 0.12f, 0.08f)
    );

    private static final String MERCURY_CHROME = "mercury_chrome";

    private record Base(byte[] gray, byte[] alpha) {}

    private final Map<String, Base> bases = new ConcurrentHashMap<>();
    private volatile byte[] mercuryPng;

    /** 이 서비스가 만들 수 있는 텍스처 키인지 */
    public boolean supports(String texture) {
        return SPECS.containsKey(texture) || MERCURY_CHROME.equals(texture);
    }

    /** 색(hex)이 필요한 텍스처인지 (mercury_chrome만 불필요) */
    public boolean needsColor(String texture) {
        return SPECS.containsKey(texture);
    }

    /**
     * @param texture  supports()가 true인 키
     * @param colorHex "#RRGGBB" 또는 "RRGGBB" (mercury_chrome은 무시)
     * @return base64 인코딩된 PNG
     * @throws IllegalArgumentException 모르는 텍스처이거나 hex 형식이 틀린 경우
     */
    public String generate(String texture, String colorHex) {
        if (MERCURY_CHROME.equals(texture)) {
            return Base64.getEncoder().encodeToString(mercuryPng());
        }
        return render(texture, colorHex, soft(texture));
    }

    /** 명세 원본 수식 그대로(보정 없음). 골든 이미지 비교 테스트용. */
    String generateReference(String texture, String colorHex) {
        return render(texture, colorHex, REFERENCE);
    }

    private String render(String texture, String colorHex, Look look) {
        Spec spec = SPECS.get(texture);
        if (spec == null) throw new IllegalArgumentException("지원하지 않는 스와치 텍스처: " + texture);
        int[] rgb = parseHex(colorHex);
        return Base64.getEncoder().encodeToString(encodePng(colorize(base(texture), spec, rgb, look)));
    }

    // ---------------------------------------------------------------------------------------------

    /**
     * 원본 수식 그대로면 화면에서 쨍해서 눈이 아프다 (명암 대비가 크고, 하이라이트가 순백이고, 색이 진함).
     * 그래서 화면용 스와치는 아래로 순하게 만든다. 골든 비교(REFERENCE)에는 적용하지 않는다.
     *  - gainMul: 베이스 명암 편차를 반영하는 배율 (대비를 낮춤)
     *  - specCap: 하이라이트가 흰색으로 가는 최대 비율 (순백 점 완화)
     *  - saturation: 목표색 채도 배율 (밝기 유지)
     *  - lift: 목표색을 흰색 쪽으로 살짝 밝히는 비율 (파스텔 쪽으로)
     */
    private record Look(float gainMul, float specCap, float saturation, float lift) {}

    private static final Look REFERENCE = new Look(1f, 1f, 1f, 0f);

    private static Look soft(String texture) {
        return switch (texture) {
            case "knit" -> new Look(0.4f, 0.55f, 0.8f, 0.05f);   // gain 3.0이 섬유를 지글거리게 해서 특히 많이 낮춘다
            case "matte" -> new Look(1.0f, 1.0f, 0.8f, 0.05f);   // 매트는 이미 gain 1.0 + 하이라이트 없음
            default -> new Look(0.65f, 0.55f, 0.8f, 0.05f);
        };
    }

    // 흰색에 가까운 색(아이보리, 화이트 등)은 밝은 쪽 명암이 전부 흰색으로 잘려서 스와치 윤곽이 흰 배경에 녹는다
    // (왼쪽 위가 사라지고 오른쪽 아래 그림자만 남아 원이 찌그러져 보임). 목표색의 가장 밝은 채널을 이 값으로
    // 눌러서(색조는 유지) 항상 가장자리와 하이라이트가 보이게 한다. 명세의 골든 색(최대 채널 221)에는 영향 없음.
    private static final float MAX_TARGET = 0.90f;

    private BufferedImage colorize(Base base, Spec s, int[] rgb, Look look) {
        float tr = rgb[0] / 255f, tg = rgb[1] / 255f, tb = rgb[2] / 255f;
        float brightest = Math.max(tr, Math.max(tg, tb));
        if (brightest > MAX_TARGET) {
            float k = MAX_TARGET / brightest;
            tr *= k;
            tg *= k;
            tb *= k;
        }
        if (look.saturation != 1f) { // 밝기(luma)는 유지하고 채도만 낮춘다
            float luma = 0.299f * tr + 0.587f * tg + 0.114f * tb;
            tr = luma + (tr - luma) * look.saturation;
            tg = luma + (tg - luma) * look.saturation;
            tb = luma + (tb - luma) * look.saturation;
        }
        if (look.lift != 0f) {
            tr += (1f - tr) * look.lift;
            tg += (1f - tg) * look.lift;
            tb += (1f - tb) * look.lift;
        }
        float gain = s.gain * look.gainMul;
        int[] px = new int[W * H];
        for (int i = 0; i < px.length; i++) {
            float d = (base.gray[i] & 0xFF) / 255f - s.median;
            float a = (base.alpha[i] & 0xFF) / 255f;
            float spec = clamp((d - s.specStart) / s.specRange) * look.specCap;
            px[i] = (channel(tr, d, spec, a, s, gain) << 16)
                    | (channel(tg, d, spec, a, s, gain) << 8)
                    | channel(tb, d, spec, a, s, gain);
        }
        BufferedImage out = new BufferedImage(W, H, BufferedImage.TYPE_INT_RGB);
        out.setRGB(0, 0, W, H, px, 0, W);
        return out;
    }

    private static int channel(float t, float d, float spec, float alpha, Spec s, float gain) {
        float c = clamp(t + gain * d);
        c = Math.max(c, t * s.shadowFloor);
        c = c + (1f - c) * spec;
        float out = c * alpha + (1f - alpha);
        return (int) (clamp(out) * 255f); // 반올림이 아니라 버림 (명세 4장)
    }

    private static float clamp(float v) {
        return v < 0f ? 0f : (v > 1f ? 1f : v);
    }

    private static int[] parseHex(String hex) {
        String h = hex == null ? "" : hex.trim();
        if (h.startsWith("#")) h = h.substring(1);
        if (!h.matches("[0-9a-fA-F]{6}")) {
            throw new IllegalArgumentException("color_hex는 #RRGGBB 형식이어야 합니다: " + hex);
        }
        return new int[]{
                Integer.parseInt(h.substring(0, 2), 16),
                Integer.parseInt(h.substring(2, 4), 16),
                Integer.parseInt(h.substring(4, 6), 16)};
    }

    /** 베이스 밝기(PIL convert('L')와 같은 정수 수식)와 원 마스크를 처음 한 번만 읽어서 캐시한다. */
    private Base base(String texture) {
        return bases.computeIfAbsent(texture, t -> {
            BufferedImage img = read("swatch/bases/" + t + "_base.png");
            BufferedImage mask = read("swatch/masks/" + t + "_alpha.png");
            if (img.getWidth() != W || img.getHeight() != H || mask.getWidth() != W || mask.getHeight() != H) {
                throw new IllegalStateException("스와치 베이스/마스크는 " + W + "x" + H + "여야 합니다: " + t);
            }
            int[] rgb = img.getRGB(0, 0, W, H, null, 0, W);
            byte[] gray = new byte[W * H];
            for (int i = 0; i < gray.length; i++) {
                int p = rgb[i];
                int r = (p >> 16) & 0xFF, g = (p >> 8) & 0xFF, b = p & 0xFF;
                gray[i] = (byte) ((r * 19595 + g * 38470 + b * 7471 + 32768) >> 16);
            }
            // 8비트 흑백 마스크는 getRGB가 감마 변환을 하므로 래스터 값을 그대로 읽는다
            byte[] alpha = new byte[W * H];
            for (int y = 0; y < H; y++) {
                for (int x = 0; x < W; x++) {
                    alpha[y * W + x] = (byte) mask.getRaster().getSample(x, y, 0);
                }
            }
            return new Base(gray, alpha);
        });
    }

    private byte[] mercuryPng() {
        byte[] cached = mercuryPng;
        if (cached == null) {
            try (InputStream in = new ClassPathResource("swatch/mercury_chrome.png").getInputStream()) {
                cached = in.readAllBytes();
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
            mercuryPng = cached;
        }
        return cached;
    }

    private static BufferedImage read(String path) {
        try (InputStream in = new ClassPathResource(path).getInputStream()) {
            BufferedImage img = ImageIO.read(in);
            if (img == null) throw new IllegalStateException("이미지를 읽을 수 없습니다: " + path);
            return img;
        } catch (IOException e) {
            throw new UncheckedIOException("스와치 리소스를 읽을 수 없습니다: " + path, e);
        }
    }

    private static byte[] encodePng(BufferedImage img) {
        try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            ImageIO.write(img, "png", out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
