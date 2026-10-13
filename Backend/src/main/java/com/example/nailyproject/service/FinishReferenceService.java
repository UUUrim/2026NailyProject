package com.example.nailyproject.service;

import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 스타일/마감별 레퍼런스 사진을 resources/finish-refs 에서 읽어 캐싱한다.
 * - "powder finish": 광택만 가져오고 색은 프롬프트를 따르게 하려고 흑백 PNG로 변환해서 보낸다.
 * - "flower art": 번지는 손그림 꽃 스타일 크롭 2장. 컬러 원본 그대로 보낸다.
 * 파일이 없으면 해당 키는 레퍼런스 없이(텍스트만으로) 생성된다.
 */
@Service
public class FinishReferenceService {

    public static final String POWDER_FINISH = "powder finish";
    public static final String FLOWER_ART = "flower art";

    private record Ref(List<String> files, boolean grayscale) {}

    private static final Map<String, Ref> REFS = Map.of(
            POWDER_FINISH, new Ref(List.of("finish-refs/powder-finish.jpg"), true),
            FLOWER_ART, new Ref(List.of("finish-refs/flower-paint-1.png", "finish-refs/flower-paint-2.png"), false)
    );

    private static final int MAX_REFERENCES = 4;

    private final Map<String, List<byte[]>> cache = new ConcurrentHashMap<>();

    public boolean has(String key) {
        return !load(key).isEmpty();
    }

    /** 주어진 키 중 레퍼런스가 실제로 있는 것만 중복 없이 돌려준다. */
    public List<String> availableFinishes(Collection<String> keys) {
        List<String> result = new ArrayList<>();
        for (String key : keys) {
            String normalized = normalize(key);
            if (!result.contains(normalized) && has(normalized)) result.add(normalized);
        }
        return result;
    }

    public List<byte[]> referencesFor(Collection<String> keys) {
        List<byte[]> result = new ArrayList<>();
        for (String key : availableFinishes(keys)) {
            for (byte[] image : load(key)) {
                if (result.size() >= MAX_REFERENCES) return result;
                result.add(image);
            }
        }
        return result;
    }

    private List<byte[]> load(String key) {
        String normalized = normalize(key);
        List<byte[]> cached = cache.get(normalized);
        if (cached != null) return cached;

        Ref ref = REFS.get(normalized);
        if (ref == null) return List.of();

        List<byte[]> images = new ArrayList<>();
        for (String path : ref.files()) {
            byte[] bytes = readImage(path, ref.grayscale());
            if (bytes != null) images.add(bytes);
        }
        if (!images.isEmpty()) cache.put(normalized, images);
        return images;
    }

    private byte[] readImage(String path, boolean grayscale) {
        ClassPathResource resource = new ClassPathResource(path);
        if (!resource.exists()) return null;
        try (InputStream in = resource.getInputStream()) {
            if (!grayscale) return in.readAllBytes();
            BufferedImage source = ImageIO.read(in);
            if (source == null) return null;
            BufferedImage gray = new BufferedImage(source.getWidth(), source.getHeight(), BufferedImage.TYPE_BYTE_GRAY);
            Graphics2D g = gray.createGraphics();
            g.drawImage(source, 0, 0, null);
            g.dispose();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            ImageIO.write(gray, "png", out);
            return out.toByteArray();
        } catch (Exception e) {
            System.err.println("[FinishReferenceService] 레퍼런스 로드 실패 (" + path + "): " + e.getMessage());
            return null;
        }
    }

    private String normalize(String key) {
        return key == null ? "" : key.trim().toLowerCase();
    }
}
