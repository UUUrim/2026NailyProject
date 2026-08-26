package com.example.nailyproject.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class NailDetectionService {

    @Value("${naily.detect-server-url}")
    private String detectServerUrl;

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    private HttpHeaders buildHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("ngrok-skip-browser-warning", "true");
        return headers;
    }

    // -------------------------------------------------------------------------
    // 1. 손톱별 대표 컬러 추출
    // -------------------------------------------------------------------------
    public List<Map<String, Object>> extractColorsPerNail(String imageBase64) {
        Map<String, Object> body = new HashMap<>();
        body.put("image_base64", imageBase64);
        body.put("segment_prompt", "nail tip");
        body.put("threshold", 0.2);
        body.put("mask_shrink", 6);
        body.put("min_area", 200);
        body.put("color_diff_threshold", 40.0);

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, buildHeaders());
        ResponseEntity<String> response = restTemplate.postForEntity(
                detectServerUrl + "/colors_per_nail", request, String.class
        );

        try {
            JsonNode root = objectMapper.readTree(response.getBody());
            JsonNode nailsNode = root.get("nails");
            List<Map<String, Object>> result = new ArrayList<>();
            if (nailsNode != null && nailsNode.isArray()) {
                for (JsonNode nail : nailsNode) {
                    Map<String, Object> nailMap = new HashMap<>();
                    nailMap.put("nail_index", nail.get("nail_index").asInt());
                    List<String> colors = new ArrayList<>();
                    nail.get("colors").forEach(c -> colors.add(c.asText()));
                    nailMap.put("colors", colors);
                    result.add(nailMap);
                }
            }
            return result;
        } catch (Exception e) {
            throw new RuntimeException("colors_per_nail 응답 파싱 실패: " + e.getMessage(), e);
        }
    }

    @SuppressWarnings("unchecked")
    public List<String> flattenToColorPalette(List<Map<String, Object>> perNailColors) {
        List<String> palette = new ArrayList<>();
        for (Map<String, Object> nail : perNailColors) {
            List<String> colors = (List<String>) nail.get("colors");
            if (colors != null) {
                for (String hex : colors) {
                    if (!palette.contains(hex)) {
                        palette.add(hex.toUpperCase());
                    }
                }
            }
        }
        return palette;
    }

    // -------------------------------------------------------------------------
    // 2. 파츠 검출
    // -------------------------------------------------------------------------
    public Map<String, List<String>> detectParts(String imageBase64, List<String> parts) {
        Map<String, Object> body = new HashMap<>();
        body.put("image_base64", imageBase64);
        body.put("parts", parts);
        body.put("threshold", 0.4);

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, buildHeaders());
        ResponseEntity<String> response = restTemplate.postForEntity(
                detectServerUrl + "/parts", request, String.class
        );

        try {
            JsonNode root = objectMapper.readTree(response.getBody());
            Map<String, List<String>> result = new HashMap<>();
            root.fields().forEachRemaining(entry -> {
                List<String> crops = new ArrayList<>();
                entry.getValue().forEach(v -> crops.add(v.asText()));
                result.put(entry.getKey(), crops);
            });
            return result;
        } catch (Exception e) {
            throw new RuntimeException("parts 응답 파싱 실패: " + e.getMessage(), e);
        }
    }

    // -------------------------------------------------------------------------
    // ★ 3. 스와치 배경 제거 — 흰 배경 → 투명 PNG
    // -------------------------------------------------------------------------

    /**
     * 스와치 이미지의 흰 배경을 투명으로 제거한다.
     * detect 서버의 /remove-bg 엔드포인트 호출 (SAM 없이 픽셀 임계값 방식).
     *
     * @param imageBase64 흰 배경이 있는 스와치 이미지 base64
     * @return 투명 배경 PNG base64
     */
    public String removeBackground(String imageBase64) {
        Map<String, Object> body = new HashMap<>();
        body.put("image_base64", imageBase64);
        body.put("threshold", 238); // 이 값보다 밝은 픽셀을 배경으로 판단

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, buildHeaders());
        ResponseEntity<String> response = restTemplate.postForEntity(
                detectServerUrl + "/remove-bg", request, String.class
        );

        try {
            JsonNode root = objectMapper.readTree(response.getBody());
            String result = root.get("image_base64").asText();
            if (result == null || result.isBlank()) {
                throw new RuntimeException("remove-bg 응답에 image_base64 없음");
            }
            return result;
        } catch (Exception e) {
            throw new RuntimeException("remove-bg 응답 파싱 실패: " + e.getMessage(), e);
        }
    }
}