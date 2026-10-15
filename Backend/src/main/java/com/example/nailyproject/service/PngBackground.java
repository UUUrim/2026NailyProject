package com.example.nailyproject.service;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;

/** 투명 배경 PNG ↔ 흰 배경 이미지 변환 유틸. */
public final class PngBackground {

    private PngBackground() {}

    /** 투명 PNG를 흰 배경 위에 얹어 불투명 PNG 바이트로 돌려준다. 디코딩에 실패하면 원본을 그대로 돌려준다. */
    public static byte[] compositeOnWhite(byte[] pngBytes) {
        try {
            BufferedImage src = ImageIO.read(new ByteArrayInputStream(pngBytes));
            if (src == null) return pngBytes;
            BufferedImage out = new BufferedImage(src.getWidth(), src.getHeight(), BufferedImage.TYPE_INT_RGB);
            Graphics2D g = out.createGraphics();
            try {
                g.setColor(Color.WHITE);
                g.fillRect(0, 0, out.getWidth(), out.getHeight());
                g.drawImage(src, 0, 0, null);
            } finally {
                g.dispose();
            }
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            ImageIO.write(out, "png", baos);
            return baos.toByteArray();
        } catch (Exception e) {
            System.err.println("[PngBackground] 흰 배경 합성 실패, 원본 사용: " + e.getMessage());
            return pngBytes;
        }
    }

    /**
     * 모델이 돌려준 PNG가 실제로 투명 배경인지 진단용 한 줄 요약을 만든다 (예: "알파 채널 있음, 테두리 투명 98%, 전체 투명 71%").
     * 투명 배경을 요청했는데 불투명(알파 없음 / 테두리가 불투명)으로 오면 모델이 요청을 무시한 것이다.
     */
    public static String describeAlpha(byte[] pngBytes) {
        try {
            BufferedImage src = ImageIO.read(new ByteArrayInputStream(pngBytes));
            if (src == null) return "이미지 디코딩 실패";
            int w = src.getWidth(), h = src.getHeight();
            boolean hasAlpha = src.getColorModel().hasAlpha();
            if (!hasAlpha) return "알파 채널 없음(불투명 " + w + "x" + h + ")";
            long border = 0, borderClear = 0, clear = 0;
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    boolean isClear = (src.getRGB(x, y) >>> 24) <= 24;
                    if (isClear) clear++;
                    if (x == 0 || y == 0 || x == w - 1 || y == h - 1) {
                        border++;
                        if (isClear) borderClear++;
                    }
                }
            }
            return String.format("알파 채널 있음 %dx%d, 테두리 투명 %d%%, 전체 투명 %d%%",
                    w, h, Math.round(100.0 * borderClear / Math.max(border, 1)), Math.round(100.0 * clear / ((long) w * h)));
        } catch (Exception e) {
            return "알파 진단 실패: " + e.getMessage();
        }
    }
}
