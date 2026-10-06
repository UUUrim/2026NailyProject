package com.example.nailyproject.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 이미지 생성 서버(main_gen.py, port 8000) 클라이언트.
 * ComfyUI 대신 Z-Image-Turbo + LoRA를 diffusers로 직접 구동하는 서버.
 *
 * 엔드포인트:
 *   POST /generate         → 프롬프트 기반 네일 이미지 생성, image_base64 반환
 *   POST /inpaint          → 특정 손톱 영역만 재생성, image_base64 반환
 *   GET  /health           → 헬스체크
 */
@Service
@RequiredArgsConstructor
public class NailImageService {

    @Value("${naily.gen-server-url}")
    private String genServerUrl;

    // ComfyUI 브릿지 서버(main_comfy.py) — 테스트용, gen-server-url과 별개 (application.yml 참고)
    @Value("${naily.comfy-server-url:}")
    private String comfyServerUrl;

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    private HttpHeaders buildHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        // ngrok 무료 플랜은 브라우저 경고 페이지를 내려보낼 수 있어서 헤더로 우회
        headers.set("ngrok-skip-browser-warning", "true");
        return headers;
    }

    // -------------------------------------------------------------------------
    // 1. 메인 네일 이미지 생성 (5손톱 전체)
    // -------------------------------------------------------------------------

    /**
     * 프롬프트 기반 네일 이미지를 생성하고 base64 문자열로 반환한다.
     *
     * @param prompt 조립된 최종 프롬프트
     * @param seed   재현용 시드 (null 이면 서버가 랜덤 처리)
     * @return base64 인코딩된 PNG 이미지
     */
    public String generateNailImage(String prompt, Long seed) {
        Map<String, Object> body = new HashMap<>();
        body.put("prompt", prompt);
        // negative_prompt 파라미터가 있지만 z-image-turbo는 반영 안 됨.
        // NailDesignService에서 "no X" 표현을 positive 프롬프트에 이미 녹여두므로 생략.
        body.put("steps", 30);
        body.put("guidance_scale", 1);
        body.put("width", 768);
        body.put("height", 512);
        if (seed != null) {
            body.put("seed", seed);
        }
        System.out.println("[NailImageService] generate seed=" + seed);

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, buildHeaders());
        ResponseEntity<String> response = restTemplate.postForEntity(
                genServerUrl + "/generate", request, String.class
        );

        return extractBase64(response.getBody(), "image_base64");
    }

    // -------------------------------------------------------------------------
    // 2. Inpaint — 특정 손톱 영역만 재생성
    // -------------------------------------------------------------------------

    /**
     * 기존 이미지에서 특정 손톱만 재생성한다. (사용자가 "이 손가락만 바꿔줘"를 눌렀을 때 호출)
     *
     * 타게팅 방식 두 가지 — nailIndexes가 있으면 그걸 우선 쓰고, 없으면(비었으면)
     * mask_prompt(GroundingDINO 시각적 탐지) 방식으로 폴백한다:
     * 1) nailIndexes: 왼쪽부터 1~5로 센 손톱 번호 목록. 서버가 nail_index를 받으면
     *    mask_prompt/mask_base64는 무시하고 그 번호의 손톱만 정확히 잡아서 수정한다.
     * 2) maskPrompt: nailIndexes가 없을 때만 사용 — GroundingDINO가 원본 이미지에서
     *    시각적 특징으로 영역을 찾는다 (예: "nail tip with bow charm").
     *
     * @param imageBase64 원본 이미지 base64
     * @param prompt      재생성할 내용 (마스크 밖 요소도 유지하려면 여기서 다시 명시)
     * @param maskPrompt  nailIndexes가 없을 때 쓰는 폴백 (GroundingDINO 탐지용 텍스트)
     * @param nailIndexes 왼쪽부터 1~5로 센 대상 손톱 번호 목록 (비어있으면 maskPrompt 사용)
     * @param seed        원본 생성 때와 동일한 시드를 써야 퀄리티가 비슷하게 유지됨
     * @return base64 인코딩된 PNG 이미지
     */
    public String inpaintNail(String imageBase64, String prompt, String maskPrompt,
                               List<Integer> nailIndexes, Long seed) {
        Map<String, Object> body = new HashMap<>();
        body.put("image_base64", imageBase64);
        body.put("prompt", prompt);
        if (nailIndexes != null && !nailIndexes.isEmpty()) {
            body.put("nail_index", nailIndexes);
        } else {
            body.put("mask_prompt", maskPrompt);
        }
        body.put("steps", 30);
        body.put("strength", 0.8);
        body.put("guidance_scale", 1);
        body.put("threshold", 0.35);
        body.put("mask_offset", 8);
        body.put("grow_mask_by", 10);
        if (seed != null) {
            body.put("seed", seed);
        }
        System.out.println("[NailImageService] inpaint seed=" + seed + " nailIndexes=" + nailIndexes);

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, buildHeaders());
        ResponseEntity<String> response = restTemplate.postForEntity(
                genServerUrl + "/inpaint", request, String.class
        );

        return extractBase64(response.getBody(), "image_base64");
    }

    // -------------------------------------------------------------------------
    // 3. 텍스처 스와치 생성 (원형 견본 이미지 1개)
    // -------------------------------------------------------------------------

    /**
     * 텍스처 스와치 프롬프트 1개를 받아 원형 견본 이미지를 생성한다.
     * TextureSwatchService가 텍스처 종류만큼 반복 호출한다.
     *
     * @param swatchPrompt TextureSwatchService가 조립한 스와치 전용 프롬프트
     * @param seed         배치 내 모든 스와치에 동일한 시드 사용 권장 (일관성)
     * @return base64 인코딩된 PNG 이미지
     */
    public String generateTextureSwatch(String swatchPrompt, Long seed) {
        Map<String, Object> body = new HashMap<>();
        body.put("prompt", swatchPrompt);
        body.put("steps", 15);          // 스와치는 빠르게 (매트는 TextureSwatchService에서 22로 올려서 호출)
        body.put("guidance_scale", 3);
        body.put("width", 512);
        body.put("height", 384);
        if (seed != null) {
            body.put("seed", seed);
        }
        System.out.println("[NailImageService] texture swatch seed=" + seed);

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, buildHeaders());
        ResponseEntity<String> response = restTemplate.postForEntity(
                genServerUrl + "/generate", request, String.class
        );

        return extractBase64(response.getBody(), "image_base64");
    }

    // -------------------------------------------------------------------------
    // 4. ComfyUI 브릿지 서버 (main_comfy.py) — 테스트용
    // -------------------------------------------------------------------------

    /**
     * ComfyUI 브릿지 서버(main_comfy.py)에 프롬프트 기반 이미지 생성을 요청한다.
     * - 요청 body는 {"prompt": "..."} 뿐이다 (steps/guidance_scale/width/height 없음).
     * - seed는 브릿지 서버 안에 고정값으로 박혀있어 요청으로 받지 않는다 — 여기서도 안 보낸다.
     * - ★ 명세서 경고: prompt에 불필요한 줄바꿈/들여쓰기 공백이 섞이면 결과가 달라진다.
     *   여러 줄로 조립된 프롬프트를 공백 하나로 이어붙여서 보낸다.
     *
     * @param prompt 조립된 최종 프롬프트 (줄바꿈/들여쓰기가 있어도 이 메서드가 정규화함)
     * @return base64 인코딩된 PNG 이미지
     */
    public String generateNailImageViaComfy(String prompt) {
        if (comfyServerUrl == null || comfyServerUrl.isBlank()) {
            throw new IllegalStateException("naily.comfy-server-url이 설정되지 않았습니다.");
        }

        // 줄 단위로 trim 후 공백 하나로 이어붙여서, 들여쓰기/줄바꿈이 텍스트 내용에 섞이지 않게 한다.
        String normalizedPrompt = String.join(" ",
                Arrays.stream(prompt.split("\\R"))
                        .map(String::trim)
                        .filter(line -> !line.isEmpty())
                        .toList()
        ).trim();

        Map<String, Object> body = new HashMap<>();
        body.put("prompt", normalizedPrompt);
        System.out.println("[NailImageService] comfy generate (seed는 브릿지 서버에 고정, 요청에 안 보냄)");

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, buildHeaders());
        ResponseEntity<String> response = restTemplate.postForEntity(
                comfyServerUrl + "/generate", request, String.class
        );

        return extractBase64(response.getBody(), "image_base64");
    }

    // -------------------------------------------------------------------------
    // 내부 유틸
    // -------------------------------------------------------------------------

    private String extractBase64(String responseBody, String key) {
        try {
            JsonNode root = objectMapper.readTree(responseBody);
            String value = root.get(key).asText();
            if (value == null || value.isBlank()) {
                throw new RuntimeException("생성 서버 응답에 " + key + " 필드가 없습니다.");
            }
            return value;
        } catch (Exception e) {
            throw new RuntimeException("생성 서버 응답 파싱 실패: " + e.getMessage()
                    + "\n원본 응답: " + responseBody, e);
        }
    }
}
