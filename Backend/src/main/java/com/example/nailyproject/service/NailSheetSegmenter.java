package com.example.nailyproject.service;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 흰 배경 위에 네일팁 5개가 놓인 생성 이미지에서, SAM/GroundingDINO 없이 순수 픽셀 연산만으로
 * 손톱 5개를 분리한다 (배경색과의 거리 임계값 → 구멍 메우기 → 연결 요소 → 큰 5개).
 *
 * 배경이 균일한 흰색이라는 전제에서만 동작한다. 5개를 못 찾으면 null을 돌려주니,
 * 호출하는 쪽에서 기존 detect 서버 경로로 폴백하면 된다.
 */
public final class NailSheetSegmenter {

    public static final int NAIL_COUNT = 5;

    /**
     * {배경과의 RGB 색 거리 임계값, 그림자 제외 여부(1/0)} — 위에서부터 차례로 시도해 5개가 나오는 첫 단계를 쓴다.
     * 윤곽을 낮은 임계값으로 넉넉하게 따고 안쪽은 전부 채우는 쪽이 기본이다. 흰색~연한 색으로 번지는 그라데이션 손톱의
     * 끝부분은 배경과 색 차이가 작은데, 엄격한 기준(30 + 그림자 제외)은 이 부분을 그림자로 보고 잘라낸다
     * (잘린 AR 크롭의 원인이었다). 엄격한 기준은 낮은 임계값에서 손톱이 한 덩어리로 뭉칠 때를 위한 마지막 폴백이다.
     */
    private static final int[][] THRESHOLD_TIERS = {{12, 0}, {18, 0}, {8, 0}, {30, 1}};
    /** 그림자 쪽 보정의 기준선이 되는 엄격한 임계값(그림자 제외 규칙과 함께 사용). */
    private static final int STRICT_THRESHOLD = 30;
    /** 끝 윤곽선 보정: 중심 계산에 쓰는 "확실히 손톱인" 픽셀의 배경 거리 / 경사 계산 창 크기(px) / 이웃 중앙값 반경. */
    private static final int RIM_CORE_DISTANCE = 30;
    private static final int RIM_WINDOW = 3;
    private static final int RIM_MEDIAN = 10;
    /** 안쪽 3px 평균과 바깥 3px 평균의 차(배경 거리 단위)가 이 값 이상이면 "가파르다"고 본다. */
    private static final double RIM_MIN_DROP = 10.0;
    /** 찾은 윤곽선 바깥으로 더 포함할 여유(px) — 윤곽선 자체가 잘리지 않게. */
    private static final int RIM_PAD = 2;
    /** 아래 방향 기준 좌우로 이 각도(도)까지를 손톱 끝 부채꼴로 본다. */
    private static final int TIP_FAN_DEGREES = 50;
    /** 낮은 임계값 영역이 엄격 영역보다 평균 이 픽셀 수 이상 더 퍼져 있어야 그 쪽에 그림자가 있다고 본다. */
    private static final double SHADOW_SIDE_MIN = 4.0;
    /** 좌우대칭으로 가장자리를 맞출 때 허용하는 오차(px). */
    private static final int SYMMETRY_TOLERANCE = 3;
    private static final int SHADOW_MAX_CHROMA = 24;
    private static final int SHADOW_MAX_BRIGHTNESS = 245;
    /** 그림자 띠/잔 노이즈를 지우는 침식→팽창(opening) 반경(px). */
    private static final int OPEN_RADIUS = 2;
    /** 이미지 면적 대비 이 비율보다 작은 덩어리는 손톱이 아니라 노이즈로 본다. */
    private static final double MIN_AREA_RATIO = 0.004;
    /** 붙어 있는 손톱을 가르기 위해 마스크를 최대 이만큼(px) 침식해 본다. */
    private static final int MAX_SPLIT_EROSION = 30;
    private static final int CROP_PADDING = 4;
    /** 대표색 추출 시 가장자리(그림자/경계 번짐)를 피하려고 안쪽으로 침식하는 픽셀 수. */
    private static final int COLOR_ERODE = 8;
    private static final double COLOR_DIFF_THRESHOLD = 40.0;
    private static final int MAX_COLORS_PER_NAIL = 3;
    /** 투명 배경 PNG에서 이 알파값(0~255)을 넘는 픽셀을 손톱으로 본다. */
    private static final int ALPHA_THRESHOLD = 24;
    /** 투명 PNG 크롭에서 윤곽 안쪽 이 픽셀 수만큼은 불투명으로 굳히고, 바깥 가장자리만 원본 알파를 유지한다. */
    private static final int ALPHA_EDGE_KEEP = 2;

    public record Nail(byte[] cropPng, List<String> colors) {}

    private NailSheetSegmenter() {}

    public static List<Nail> segment(byte[] imageBytes) {
        try {
            BufferedImage img = ImageIO.read(new ByteArrayInputStream(imageBytes));
            if (img == null) return null;
            return segment(img);
        } catch (Exception e) {
            System.err.println("[NailSheetSegmenter] 실패: " + e.getMessage());
            return null;
        }
    }

    private static List<Nail> segment(BufferedImage img) throws Exception {
        int w = img.getWidth();
        int h = img.getHeight();
        int[] rgb = img.getRGB(0, 0, w, h, null, 0, w);

        // 배경이 투명한 PNG(GPT 이미지 background=transparent)면 색 거리 대신 알파값으로 손톱을 바로 가른다.
        if (hasTransparentBackground(rgb, w, h)) {
            int[] labels = computeLabels(rgb, new int[]{255, 255, 255}, w, h, 0, false, true);
            List<Nail> nails = labels == null ? null : buildNails(img, rgb, labels, w, h, true);
            if (nails != null) {
                System.out.println("[NailSheetSegmenter] 성공 (투명 배경, 알파 마스크)");
                return nails;
            }
            System.out.println("[NailSheetSegmenter] 투명 배경 알파 마스크로 5개를 못 찾음");
            return null;
        }

        int[] bg = estimateBackground(rgb, w, h);

        // 낮은 임계값(윤곽을 넉넉히)부터 시도해 5개가 나오는 첫 단계를 쓴다. 이 단계에서는 그림자 제외 규칙을 끈다
        // (흰 손톱은 그림자와 색이 구분되지 않고, 오히려 그림자가 윤곽을 알려준다).
        for (int[] tier : THRESHOLD_TIERS) {
            double threshold = tier[0];
            boolean excludeShadow = tier[1] == 1;
            int[] labels = computeLabels(rgb, bg, w, h, threshold, excludeShadow, false);
            if (labels == null) continue;
            // 낮은 임계값은 손톱 옆으로 번진 그림자까지 따므로, 엄격한 기준으로 딴 영역과 비교해 그림자가 있는 쪽만 걷어낸다.
            boolean clipped = false;
            if (!excludeShadow) {
                int[] strict = computeLabels(rgb, bg, w, h, STRICT_THRESHOLD, true, false);
                if (strict != null) clipped = clipShadowSide(labels, strict, w, h);
            }
            // 손톱 끝(아래) 쪽은 그림자 자락이 같이 따이므로, 끝의 날카로운 윤곽선에서 한 번 더 자른다.
            boolean tipTrimmed = !excludeShadow && trimTipByRim(labels, rgb, bg, w, h);
            System.out.println("[NailSheetSegmenter] 성공 (임계값 " + (int) threshold + ", 그림자 제외 " + excludeShadow
                    + ", 옆 그림자 보정 " + clipped + ", 끝 윤곽선 보정 " + tipTrimmed + ")");
            return buildNails(img, rgb, labels, w, h, false);
        }
        System.out.println("[NailSheetSegmenter] 모든 임계값에서 5개를 못 찾음 (bg=" + java.util.Arrays.toString(bg) + ")");
        return null;
    }

    /** 손톱 5개의 라벨 맵(1~5, 왼쪽→오른쪽, 0=배경)을 만든다. 5개를 못 찾으면 null. */
    private static int[] computeLabels(int[] rgb, int[] bg, int w, int h,
                                       double threshold, boolean excludeShadow, boolean alphaMode) {
        boolean[] mask = new boolean[w * h];
        for (int i = 0; i < mask.length; i++) {
            mask[i] = alphaMode
                    ? (rgb[i] >>> 24) > ALPHA_THRESHOLD
                    : distance(rgb[i], bg) > threshold && !(excludeShadow && isShadow(rgb[i]));
        }

        mask = open(mask, w, h, OPEN_RADIUS);
        fillHoles(mask, w, h);

        int minArea = (int) (w * (double) h * MIN_AREA_RATIO);

        // 손톱끼리 얇게 붙어 한 덩어리가 되는 경우가 있어서, 5개 이상으로 갈라질 때까지 마스크를 조금씩
        // 침식해 "핵심 영역"을 찾고, 원래 마스크 안에서 그 핵심들을 다시 키워 경계를 나눈다(워터셰드와 같은 발상).
        boolean[] core = mask;
        int[] labels = null;
        List<int[]> comps = null;
        List<int[]> big = null;
        for (int erosion = 0; erosion <= MAX_SPLIT_EROSION; erosion++) {
            if (erosion > 0) core = erode(core, w, h);
            labels = new int[w * h];
            comps = labelComponents(core, labels, w, h);
            big = new ArrayList<>();
            for (int[] c : comps) if (c[1] >= minArea) big.add(c);
            if (big.size() >= NAIL_COUNT) break;
        }
        if (big.size() < NAIL_COUNT) {
            // 침식으로도 안 갈라지면(그림자로 손톱 사이가 두껍게 이어진 경우) 가로로 나란히 놓인 점을 이용해
            // 열별 면적이 가장 작은 골짜기 4곳을 잘라서 나눈다.
            boolean[] cut = cutAtColumnValleys(mask, w, h);
            if (cut != null) {
                labels = new int[w * h];
                comps = labelComponents(cut, labels, w, h);
                big = new ArrayList<>();
                for (int[] c : comps) if (c[1] >= minArea) big.add(c);
            }
        }
        if (big.size() < NAIL_COUNT) {
            System.out.println("[NailSheetSegmenter] 임계값 " + (int) threshold + ": 큰 덩어리 " + big.size() + "개 → 5개 아님");
            return null;
        }

        big.sort((a, b) -> Integer.compare(b[1], a[1]));
        List<int[]> picked = new ArrayList<>(big.subList(0, NAIL_COUNT));
        // 6번째로 큰 덩어리가 5번째와 비슷하면 5개가 아니라 다른 구성(예: 손톱이 둘로 쪼개짐)이라 신뢰할 수 없다.
        if (big.size() > NAIL_COUNT && big.get(NAIL_COUNT)[1] > picked.get(NAIL_COUNT - 1)[1] * 0.5) {
            System.out.println("[NailSheetSegmenter] 임계값 " + (int) threshold + ": 큰 덩어리가 " + big.size() + "개라 모호함");
            return null;
        }

        // 고른 5개의 핵심만 씨앗으로 두고 원래 마스크 전체로 다시 키운다 (가까운 핵심이 그 픽셀을 가져감).
        int[] finalLabels = new int[w * h];
        int[] queue = new int[w * h];
        int head = 0, tail = 0;
        picked.sort(Comparator.comparingInt(c -> c[6])); // 왼쪽 → 오른쪽 (엄지 → 새끼)
        int[] labelOf = new int[nextLabelBound(comps)];
        for (int i = 0; i < picked.size(); i++) labelOf[picked.get(i)[0]] = i + 1;
        for (int p = 0; p < finalLabels.length; p++) {
            if (labels[p] != 0 && labelOf[labels[p]] != 0) {
                finalLabels[p] = labelOf[labels[p]];
                queue[tail++] = p;
            }
        }
        while (head < tail) {
            int p = queue[head++];
            int x = p % w, y = p / w, l = finalLabels[p];
            if (x > 0 && mask[p - 1] && finalLabels[p - 1] == 0) { finalLabels[p - 1] = l; queue[tail++] = p - 1; }
            if (x < w - 1 && mask[p + 1] && finalLabels[p + 1] == 0) { finalLabels[p + 1] = l; queue[tail++] = p + 1; }
            if (y > 0 && mask[p - w] && finalLabels[p - w] == 0) { finalLabels[p - w] = l; queue[tail++] = p - w; }
            if (y < h - 1 && mask[p + w] && finalLabels[p + w] == 0) { finalLabels[p + w] = l; queue[tail++] = p + w; }
        }

        // 손톱은 볼록한 모양이라, 윤곽(그림자 포함)만 따졌을 때 안쪽이 비거나 윤곽이 한쪽만 이어진 경우도
        // 각 손톱을 볼록 껍질로 메워서 "윤곽 안쪽은 전부 손톱"으로 만든다. 다른 손톱 픽셀은 건드리지 않는다.
        for (int i = 1; i <= NAIL_COUNT; i++) fillConvexHull(finalLabels, w, h, i);

        return finalLabels;
    }

    /**
     * 손톱 옆으로 번진 그림자를 걷어낸다.
     *
     * 낮은 임계값으로 딴 영역(labels)은 흰색으로 번지는 손톱 끝까지 온전히 담지만 그림자도 같이 담는다. 그림자는 보통
     * 한쪽(빛의 반대쪽)에만 깔리고 손톱은 좌우대칭이므로, 엄격한 기준으로 딴 영역(strict, 그림자 없는 손톱 윗부분)과
     * 비교해 어느 쪽에 그림자가 있는지 알아낸 뒤, 그림자 없는 쪽 가장자리를 손톱 중심축에 대해 반대편으로 대칭시켜
     * 그림자 쪽 가장자리를 그 위치로 자른다. 어느 쪽에도 뚜렷한 그림자가 없으면 건드리지 않는다.
     *
     * @return 하나라도 자른 손톱이 있으면 true
     */
    private static boolean clipShadowSide(int[] labels, int[] strict, int w, int h) {
        boolean any = false;
        for (int label = 1; label <= NAIL_COUNT; label++) {
            int[] incL = new int[h], incR = new int[h], strL = new int[h], strR = new int[h];
            java.util.Arrays.fill(incL, Integer.MAX_VALUE);
            java.util.Arrays.fill(strL, Integer.MAX_VALUE);
            java.util.Arrays.fill(incR, -1);
            java.util.Arrays.fill(strR, -1);
            int sy0 = h, sy1 = -1;
            for (int p = 0; p < labels.length; p++) {
                int x = p % w, y = p / w;
                if (labels[p] == label) {
                    if (x < incL[y]) incL[y] = x;
                    if (x > incR[y]) incR[y] = x;
                }
                if (strict[p] == label) {
                    if (x < strL[y]) strL[y] = x;
                    if (x > strR[y]) strR[y] = x;
                    if (y < sy0) sy0 = y;
                    if (y > sy1) sy1 = y;
                }
            }
            if (sy1 < sy0) continue;

            // 엄격 영역의 20%~80% 높이(옆면이 곧은 구간)에서 좌/우로 얼마나 더 퍼져 있는지, 그리고 중심축을 구한다.
            int from = sy0 + (int) ((sy1 - sy0) * 0.2), to = sy0 + (int) ((sy1 - sy0) * 0.8);
            double dLeft = 0, dRight = 0, axis = 0;
            int rows = 0;
            for (int y = from; y <= to; y++) {
                if (strR[y] < 0 || incR[y] < 0) continue;
                dLeft += strL[y] - incL[y];
                dRight += incR[y] - strR[y];
                axis += (strL[y] + strR[y]) / 2.0;
                rows++;
            }
            if (rows == 0) continue;
            dLeft /= rows; dRight /= rows; axis /= rows;
            if (Math.max(dLeft, dRight) < SHADOW_SIDE_MIN) continue; // 어느 쪽에도 뚜렷한 그림자 없음

            boolean trustLeft = dLeft < dRight; // 그림자가 오른쪽에 있으면 왼쪽 가장자리를 믿는다
            for (int y = 0; y < h; y++) {
                if (incR[y] < 0) continue;
                int lo, hi;
                if (trustLeft) {
                    lo = incL[y];
                    hi = Math.min(incR[y], (int) Math.round(2 * axis - incL[y]) + SYMMETRY_TOLERANCE);
                } else {
                    hi = incR[y];
                    lo = Math.max(incL[y], (int) Math.round(2 * axis - incR[y]) - SYMMETRY_TOLERANCE);
                }
                for (int x = incL[y]; x <= incR[y]; x++) {
                    int p = y * w + x;
                    if (labels[p] == label && (x < lo || x > hi)) { labels[p] = 0; any = true; }
                }
            }
        }
        return any;
    }

    /**
     * 손톱 끝(아래쪽) 부채꼴 방향에서만 윤곽선(날카로운 림) 바깥을 잘라낸다.
     *
     * 손톱 끝은 흰색으로 번져서 그 아래 깔린 그림자와 색으로는 구분되지 않지만, 손톱 가장자리에는 얇고 날카로운
     * 윤곽선이 있고 그 바깥의 그림자는 완만하게 번진다. 손톱 중심에서 아래 방향(±TIP_FAN_DEGREES)으로 쏜
     * 방사선마다 배경 거리가 가장 바깥에서 가파르게 떨어지는 지점을 윤곽으로 보고 그 바깥을 지운다. 옆면은
     * 하이라이트(반짝이는 줄) 때문에 이 방법이 불안정해서 건드리지 않는다.
     *
     * @return 하나라도 자른 손톱이 있으면 true
     */
    private static boolean trimTipByRim(int[] labels, int[] rgb, int[] bg, int w, int h) {
        float[] dist = new float[w * h];
        for (int p = 0; p < dist.length; p++) dist[p] = (float) distance(rgb[p], bg);
        boolean any = false;
        final int rays = 2 * TIP_FAN_DEGREES + 1; // 1도 간격
        for (int label = 1; label <= NAIL_COUNT; label++) {
            double sx = 0, sy = 0, ax = 0, ay = 0;
            long n = 0, nAll = 0;
            int minX = w, minY = h, maxX = 0, maxY = 0;
            for (int p = 0; p < labels.length; p++) {
                if (labels[p] != label) continue;
                int x = p % w, y = p / w;
                ax += x; ay += y; nAll++;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                if (dist[p] > RIM_CORE_DISTANCE) { sx += x; sy += y; n++; }
            }
            if (nAll == 0) continue;
            double cx = n > 0 ? sx / n : ax / nAll, cy = n > 0 ? sy / n : ay / nAll;
            int maxR = (int) Math.hypot(maxX - minX, maxY - minY) + 4;

            double[] edge = new double[rays];
            for (int k = 0; k < rays; k++) {
                double th = Math.toRadians(90 - TIP_FAN_DEGREES + k); // 90도 = 정확히 아래
                double ux = Math.cos(th), uy = Math.sin(th);
                int rOut = 0;
                for (int r = 1; r <= maxR; r++) {
                    int x = (int) Math.round(cx + ux * r), y = (int) Math.round(cy + uy * r);
                    if (x < 0 || y < 0 || x >= w || y >= h || labels[y * w + x] != label) break;
                    rOut = r;
                }
                edge[k] = rOut;
                if (rOut < 2 * RIM_WINDOW + 4) continue;
                float[] prof = new float[rOut + RIM_WINDOW + 2];
                for (int r = 0; r < prof.length; r++) {
                    int x = (int) Math.round(cx + ux * r), y = (int) Math.round(cy + uy * r);
                    prof[r] = (x < 0 || y < 0 || x >= w || y >= h) ? 0f : dist[y * w + x];
                }
                // 가장 바깥에서 가파르게 떨어지는 지점. 손톱 몸통 안쪽(바깥쪽 40% 이내)에서만 찾는다.
                for (int r = rOut; r >= (int) (rOut * 0.6) && r >= RIM_WINDOW; r--) {
                    double inner = 0, outerAvg = 0;
                    for (int q = 1; q <= RIM_WINDOW; q++) {
                        inner += prof[Math.max(0, r - q + 1)];
                        outerAvg += prof[Math.min(prof.length - 1, r + q)];
                    }
                    if ((inner - outerAvg) / RIM_WINDOW >= RIM_MIN_DROP) {
                        edge[k] = Math.min(rOut, r + RIM_PAD);
                        break;
                    }
                }
            }

            // 이웃 방사선 중앙값으로 매끈하게
            double[] smooth = new double[rays];
            double[] win = new double[2 * RIM_MEDIAN + 1];
            for (int k = 0; k < rays; k++) {
                for (int q = -RIM_MEDIAN; q <= RIM_MEDIAN; q++) {
                    win[q + RIM_MEDIAN] = edge[Math.max(0, Math.min(rays - 1, k + q))];
                }
                double[] sorted = win.clone();
                java.util.Arrays.sort(sorted);
                smooth[k] = sorted[RIM_MEDIAN];
            }

            for (int p = 0; p < labels.length; p++) {
                if (labels[p] != label) continue;
                double dx = p % w - cx, dy = p / w - cy;
                if (dy <= 0) continue;
                double ang = Math.toDegrees(Math.atan2(dy, dx)); // 0~180, 90 = 아래
                int k = (int) Math.round(ang - (90 - TIP_FAN_DEGREES));
                if (k < 0 || k >= rays) continue; // 부채꼴 밖(옆면)은 그대로
                if (Math.hypot(dx, dy) > smooth[k]) { labels[p] = 0; any = true; }
            }
            // 자르고 남은 모양의 홈/돌기를 볼록 껍질로 매끈하게 정리한다.
            fillConvexHull(labels, w, h, label);
        }
        return any;
    }

    private static List<Nail> buildNails(BufferedImage img, int[] rgb, int[] finalLabels, int w, int h,
                                         boolean alphaMode) throws Exception {
        // 라벨 기준으로 bbox 계산
        int[][] boxes = new int[NAIL_COUNT + 1][];
        for (int i = 1; i <= NAIL_COUNT; i++) boxes[i] = new int[]{i, 0, w, h, 0, 0, 0};
        for (int p = 0; p < finalLabels.length; p++) {
            int l = finalLabels[p];
            if (l == 0) continue;
            int x = p % w, y = p / w;
            int[] b = boxes[l];
            b[1]++;
            if (x < b[2]) b[2] = x;
            if (y < b[3]) b[3] = y;
            if (x > b[4]) b[4] = x;
            if (y > b[5]) b[5] = y;
        }

        List<Nail> result = new ArrayList<>();
        for (int i = 1; i <= NAIL_COUNT; i++) {
            result.add(buildNail(img, rgb, finalLabels, null, w, h, boxes[i], alphaMode));
        }
        return result;
    }

    /** 열별 마스크 면적의 골짜기 4곳을 세로로 잘라 5덩어리로 만든다. 골짜기를 못 찾으면 null. */
    private static boolean[] cutAtColumnValleys(boolean[] mask, int w, int h) {
        int[] col = new int[w];
        int minX = w, maxX = -1;
        for (int p = 0; p < mask.length; p++) {
            if (!mask[p]) continue;
            int x = p % w;
            col[x]++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
        }
        if (maxX - minX < NAIL_COUNT * 20) return null;
        int span = maxX - minX;

        int win = Math.max(3, span / 120);
        double[] smooth = new double[w];
        for (int x = minX; x <= maxX; x++) {
            int lo = Math.max(minX, x - win), hi = Math.min(maxX, x + win);
            long sum = 0;
            for (int i = lo; i <= hi; i++) sum += col[i];
            smooth[x] = sum / (double) (hi - lo + 1);
        }

        int exclusion = (int) (span * 0.08);
        int edgeMargin = (int) (span * 0.08);
        boolean[] banned = new boolean[w];
        List<Integer> cuts = new ArrayList<>();
        for (int k = 0; k < NAIL_COUNT - 1; k++) {
            int best = -1;
            for (int x = minX + edgeMargin; x <= maxX - edgeMargin; x++) {
                if (banned[x]) continue;
                if (best < 0 || smooth[x] < smooth[best]) best = x;
            }
            if (best < 0) return null;
            cuts.add(best);
            for (int x = Math.max(0, best - exclusion); x <= Math.min(w - 1, best + exclusion); x++) banned[x] = true;
        }

        boolean[] out = mask.clone();
        for (int cx : cuts) {
            for (int x = Math.max(0, cx - 1); x <= Math.min(w - 1, cx + 1); x++) {
                for (int y = 0; y < h; y++) out[y * w + x] = false;
            }
        }
        return out;
    }

    /** label이 칠해진 픽셀들의 볼록 껍질 안쪽 중 아직 비어있는(0) 픽셀을 label로 채운다. */
    private static void fillConvexHull(int[] labels, int w, int h, int label) {
        // 행마다 가장 왼쪽/오른쪽 픽셀만 모아도 껍질은 같다.
        int[] rowMin = new int[h], rowMax = new int[h];
        java.util.Arrays.fill(rowMin, Integer.MAX_VALUE);
        java.util.Arrays.fill(rowMax, -1);
        int count = 0;
        for (int p = 0; p < labels.length; p++) {
            if (labels[p] != label) continue;
            int x = p % w, y = p / w;
            if (x < rowMin[y]) rowMin[y] = x;
            if (x > rowMax[y]) rowMax[y] = x;
            count++;
        }
        if (count < 3) return;
        List<int[]> pts = new ArrayList<>();
        for (int y = 0; y < h; y++) {
            if (rowMax[y] < 0) continue;
            pts.add(new int[]{rowMin[y], y});
            if (rowMax[y] != rowMin[y]) pts.add(new int[]{rowMax[y], y});
        }
        pts.sort((a, b) -> a[0] != b[0] ? Integer.compare(a[0], b[0]) : Integer.compare(a[1], b[1]));

        // Andrew monotone chain
        int n = pts.size();
        int[][] hull = new int[2 * n][];
        int k = 0;
        for (int i = 0; i < n; i++) {
            while (k >= 2 && cross(hull[k - 2], hull[k - 1], pts.get(i)) <= 0) k--;
            hull[k++] = pts.get(i);
        }
        for (int i = n - 2, t = k + 1; i >= 0; i--) {
            while (k >= t && cross(hull[k - 2], hull[k - 1], pts.get(i)) <= 0) k--;
            hull[k++] = pts.get(i);
        }
        k--; // 마지막 점은 첫 점과 같다
        if (k < 3) return;

        int[] hMin = new int[h], hMax = new int[h];
        java.util.Arrays.fill(hMin, Integer.MAX_VALUE);
        java.util.Arrays.fill(hMax, -1);
        for (int i = 0; i < k; i++) {
            int[] a = hull[i], b = hull[(i + 1) % k];
            int y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
            for (int y = y0; y <= y1; y++) {
                double x = a[1] == b[1] ? Math.min(a[0], b[0])
                        : a[0] + (double) (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]);
                int xl = (int) Math.floor(x), xr = (int) Math.ceil(x);
                if (a[1] == b[1]) xr = Math.max(a[0], b[0]);
                if (xl < hMin[y]) hMin[y] = xl;
                if (xr > hMax[y]) hMax[y] = xr;
            }
        }
        for (int y = 0; y < h; y++) {
            if (hMax[y] < 0) continue;
            for (int x = Math.max(0, hMin[y]); x <= Math.min(w - 1, hMax[y]); x++) {
                if (labels[y * w + x] == 0) labels[y * w + x] = label;
            }
        }
    }

    private static long cross(int[] o, int[] a, int[] b) {
        return (long) (a[0] - o[0]) * (b[1] - o[1]) - (long) (a[1] - o[1]) * (b[0] - o[0]);
    }

    private static int nextLabelBound(List<int[]> comps) {
        return comps.size() + 2;
    }

    /** 4-연결 요소 라벨링. 반환: {label, area, minX, minY, maxX, maxY, centerX} 목록. */
    private static List<int[]> labelComponents(boolean[] mask, int[] labels, int w, int h) {
        List<int[]> comps = new ArrayList<>();
        int[] queue = new int[w * h];
        int nextLabel = 1;
        for (int start = 0; start < mask.length; start++) {
            if (!mask[start] || labels[start] != 0) continue;
            int head = 0, tail = 0;
            queue[tail++] = start;
            labels[start] = nextLabel;
            int area = 0, minX = w, minY = h, maxX = 0, maxY = 0;
            long sumX = 0;
            while (head < tail) {
                int p = queue[head++];
                int x = p % w, y = p / w;
                area++;
                sumX += x;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                if (x > 0 && mask[p - 1] && labels[p - 1] == 0) { labels[p - 1] = nextLabel; queue[tail++] = p - 1; }
                if (x < w - 1 && mask[p + 1] && labels[p + 1] == 0) { labels[p + 1] = nextLabel; queue[tail++] = p + 1; }
                if (y > 0 && mask[p - w] && labels[p - w] == 0) { labels[p - w] = nextLabel; queue[tail++] = p - w; }
                if (y < h - 1 && mask[p + w] && labels[p + w] == 0) { labels[p + w] = nextLabel; queue[tail++] = p + w; }
            }
            comps.add(new int[]{nextLabel, area, minX, minY, maxX, maxY, (int) (sumX / Math.max(area, 1))});
            nextLabel++;
        }
        return comps;
    }

    private static Nail buildNail(BufferedImage img, int[] rgb, int[] labels, boolean[] mask, int w, int h, int[] c,
                                  boolean alphaMode) throws Exception {
        int label = c[0];
        int x0 = Math.max(0, c[2] - CROP_PADDING), y0 = Math.max(0, c[3] - CROP_PADDING);
        int x1 = Math.min(w - 1, c[4] + CROP_PADDING), y1 = Math.min(h - 1, c[5] + CROP_PADDING);
        int cw = x1 - x0 + 1, ch = y1 - y0 + 1;

        BufferedImage out = new BufferedImage(cw, ch, BufferedImage.TYPE_INT_ARGB);
        boolean[] own = new boolean[cw * ch];
        for (int y = 0; y < ch; y++) {
            for (int x = 0; x < cw; x++) {
                own[y * cw + x] = labels[(y + y0) * w + (x + x0)] == label;
            }
        }
        // 투명 PNG: 윤곽에서 ALPHA_EDGE_KEEP px 안쪽은 "흰 배경에 얹었을 때의 색"으로 굳혀서 완전 불투명으로 만든다.
        // 화면에 보여주는 흰 배경 합성 이미지와 똑같은 색이 되고, 몸통이 반투명하게 나와도 AR에서 손톱이 비치지 않는다.
        // 바깥 가장자리는 원본 색/알파를 그대로 둬서 윤곽이 부드럽게 남는다.
        boolean[] core = own;
        if (alphaMode) for (int i = 0; i < ALPHA_EDGE_KEEP; i++) core = erode(core, cw, ch);
        for (int y = 0; y < ch; y++) {
            for (int x = 0; x < cw; x++) {
                if (!own[y * cw + x]) continue;
                boolean edge = x == 0 || y == 0 || x == cw - 1 || y == ch - 1
                        || !own[y * cw + x - 1] || !own[y * cw + x + 1]
                        || !own[(y - 1) * cw + x] || !own[(y + 1) * cw + x];
                int src = rgb[(y + y0) * w + (x + x0)];
                if (alphaMode) {
                    if (core[y * cw + x]) {
                        int a = src >>> 24;
                        int r = blendOverWhite((src >> 16) & 0xFF, a);
                        int g = blendOverWhite((src >> 8) & 0xFF, a);
                        int b = blendOverWhite(src & 0xFF, a);
                        out.setRGB(x, y, 0xFF000000 | (r << 16) | (g << 8) | b);
                    } else {
                        out.setRGB(x, y, src);
                    }
                    continue;
                }
                int alpha = edge ? 140 : 255; // 가장자리 1px는 반투명으로 계단 현상 완화
                out.setRGB(x, y, (alpha << 24) | (src & 0xFFFFFF));
            }
        }
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        ImageIO.write(out, "png", baos);

        boolean[] inner = own;
        for (int i = 0; i < COLOR_ERODE; i++) inner = erode(inner, cw, ch);
        return new Nail(baos.toByteArray(), dominantColors(out, inner, cw, ch));
    }

    /** 채널값을 알파만큼 흰색(255) 위에 얹은 결과. */
    private static int blendOverWhite(int channel, int alpha) {
        return Math.round(channel * (alpha / 255f) + 255f * (1f - alpha / 255f));
    }

    // ── 대표색 ────────────────────────────────────────────────────────────────

    private static List<String> dominantColors(BufferedImage crop, boolean[] inner, int cw, int ch) {
        // 16단계로 양자화한 히스토그램에서 많이 나온 순으로 뽑고, 서로 가까운 색은 합친다.
        Map<Integer, long[]> buckets = new HashMap<>(); // key → {count, sumR, sumG, sumB}
        long total = 0;
        for (int y = 0; y < ch; y++) {
            for (int x = 0; x < cw; x++) {
                if (!inner[y * cw + x]) continue;
                int p = crop.getRGB(x, y);
                int r = (p >> 16) & 0xFF, g = (p >> 8) & 0xFF, b = p & 0xFF;
                if (r > 246 && g > 246 && b > 246) continue; // 하이라이트 반사광은 손톱색이 아님
                int key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
                long[] s = buckets.computeIfAbsent(key, k -> new long[4]);
                s[0]++; s[1] += r; s[2] += g; s[3] += b;
                total++;
            }
        }
        List<long[]> sorted = new ArrayList<>(buckets.values());
        sorted.sort((a, b) -> Long.compare(b[0], a[0]));

        List<int[]> chosen = new ArrayList<>(); // {r, g, b}
        List<String> hex = new ArrayList<>();
        for (long[] s : sorted) {
            if (chosen.size() >= MAX_COLORS_PER_NAIL) break;
            if (!chosen.isEmpty() && s[0] < total * 0.04) break; // 2번째 이후 색은 최소 4% 이상 차지해야 함
            int r = (int) (s[1] / s[0]), g = (int) (s[2] / s[0]), b = (int) (s[3] / s[0]);
            boolean tooClose = false;
            for (int[] c : chosen) {
                double d = Math.sqrt((r - c[0]) * (r - c[0]) + (g - c[1]) * (g - c[1]) + (b - c[2]) * (b - c[2]));
                if (d < COLOR_DIFF_THRESHOLD) { tooClose = true; break; }
            }
            if (tooClose) continue;
            chosen.add(new int[]{r, g, b});
            hex.add(String.format("#%02X%02X%02X", r, g, b));
        }
        return hex;
    }

    // ── 배경 / 마스크 연산 ────────────────────────────────────────────────────

    /** 테두리 픽셀의 90% 이상이 (거의) 완전 투명이면 투명 배경 PNG로 본다. */
    private static boolean hasTransparentBackground(int[] rgb, int w, int h) {
        long transparent = 0, total = 0;
        for (int x = 0; x < w; x++) {
            for (int y : new int[]{0, h - 1}) {
                total++;
                if ((rgb[y * w + x] >>> 24) <= ALPHA_THRESHOLD) transparent++;
            }
        }
        for (int y = 1; y < h - 1; y++) {
            for (int x : new int[]{0, w - 1}) {
                total++;
                if ((rgb[y * w + x] >>> 24) <= ALPHA_THRESHOLD) transparent++;
            }
        }
        return total > 0 && transparent >= total * 0.9;
    }

    /** 테두리 픽셀의 평균을 배경색으로 쓴다 (손톱이 테두리에 닿지 않는다는 전제). */
    private static int[] estimateBackground(int[] rgb, int w, int h) {
        int margin = Math.max(2, Math.min(w, h) / 50);
        long r = 0, g = 0, b = 0, n = 0;
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                if (x >= margin && x < w - margin && y >= margin && y < h - margin) {
                    x = w - margin - 1; // 안쪽은 건너뛰기
                    continue;
                }
                int p = rgb[y * w + x];
                r += (p >> 16) & 0xFF; g += (p >> 8) & 0xFF; b += p & 0xFF; n++;
            }
        }
        return new int[]{(int) (r / n), (int) (g / n), (int) (b / n)};
    }

    /**
     * 손톱 옆에 깔리는 드롭 섀도우: 무채색(R≈G≈B)이면서 배경보다 어둡다. 손톱은 분홍/살구 계열이라 채도가 있고,
     * 반사광(하이라이트)은 무채색이어도 매우 밝아서 구분된다 (손톱 안쪽 하이라이트는 구멍 메우기로 다시 포함됨).
     */
    private static boolean isShadow(int p) {
        int r = (p >> 16) & 0xFF, g = (p >> 8) & 0xFF, b = p & 0xFF;
        int max = Math.max(r, Math.max(g, b)), min = Math.min(r, Math.min(g, b));
        return max - min < SHADOW_MAX_CHROMA && max < SHADOW_MAX_BRIGHTNESS;
    }

    private static double distance(int p, int[] bg) {
        int dr = ((p >> 16) & 0xFF) - bg[0];
        int dg = ((p >> 8) & 0xFF) - bg[1];
        int db = (p & 0xFF) - bg[2];
        return Math.sqrt(dr * dr + dg * dg + db * db);
    }

    /** 가장자리에서 flood fill로 닿는 배경만 남기고, 안에 갇힌 배경 같은 픽셀(손톱 안쪽 하이라이트 등)은 손톱으로 메운다. */
    private static void fillHoles(boolean[] mask, int w, int h) {
        boolean[] outside = new boolean[w * h];
        int[] queue = new int[w * h];
        int head = 0, tail = 0;
        for (int x = 0; x < w; x++) {
            for (int y : new int[]{0, h - 1}) {
                int p = y * w + x;
                if (!mask[p] && !outside[p]) { outside[p] = true; queue[tail++] = p; }
            }
        }
        for (int y = 0; y < h; y++) {
            for (int x : new int[]{0, w - 1}) {
                int p = y * w + x;
                if (!mask[p] && !outside[p]) { outside[p] = true; queue[tail++] = p; }
            }
        }
        while (head < tail) {
            int p = queue[head++];
            int x = p % w, y = p / w;
            if (x > 0 && !mask[p - 1] && !outside[p - 1]) { outside[p - 1] = true; queue[tail++] = p - 1; }
            if (x < w - 1 && !mask[p + 1] && !outside[p + 1]) { outside[p + 1] = true; queue[tail++] = p + 1; }
            if (y > 0 && !mask[p - w] && !outside[p - w]) { outside[p - w] = true; queue[tail++] = p - w; }
            if (y < h - 1 && !mask[p + w] && !outside[p + w]) { outside[p + w] = true; queue[tail++] = p + w; }
        }
        for (int i = 0; i < mask.length; i++) if (!outside[i]) mask[i] = true;
    }

    private static boolean[] open(boolean[] mask, int w, int h, int radius) {
        boolean[] m = mask;
        for (int i = 0; i < radius; i++) m = erode(m, w, h);
        for (int i = 0; i < radius; i++) m = dilate(m, w, h);
        return m;
    }

    /** 3x3 침식 (가로/세로 분리). 이미지 밖은 비어있는 것으로 취급. */
    private static boolean[] erode(boolean[] m, int w, int h) {
        boolean[] tmp = new boolean[m.length];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int p = y * w + x;
                tmp[p] = m[p] && x > 0 && x < w - 1 && m[p - 1] && m[p + 1];
            }
        }
        boolean[] out = new boolean[m.length];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int p = y * w + x;
                out[p] = tmp[p] && y > 0 && y < h - 1 && tmp[p - w] && tmp[p + w];
            }
        }
        return out;
    }

    private static boolean[] dilate(boolean[] m, int w, int h) {
        boolean[] tmp = new boolean[m.length];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int p = y * w + x;
                tmp[p] = m[p] || (x > 0 && m[p - 1]) || (x < w - 1 && m[p + 1]);
            }
        }
        boolean[] out = new boolean[m.length];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int p = y * w + x;
                out[p] = tmp[p] || (y > 0 && tmp[p - w]) || (y < h - 1 && tmp[p + w]);
            }
        }
        return out;
    }
}
