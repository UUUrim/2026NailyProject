package com.example.nailyproject.service;

import com.example.nailyproject.dto.request.InpaintRequestDto;
import com.example.nailyproject.dto.response.InpaintResponseDto;
import com.example.nailyproject.entity.NailDesign;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.NailDesignRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class InpaintService {

    private final NailDesignRepository nailDesignRepository;
    private final S3Service s3Service;
    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate = new RestTemplate();

    // application.yml에 gen.server.url 추가 필요
    // 예) gen.server.url: http://localhost:8000  (main_gen.py)
    @Value("${gen.server.url:http://localhost:8000}")
    private String genServerUrl;

    /**
     * 특정 디자인의 선택한 손톱(들)만 교체하고 결과 이미지를 S3에 저장한다.
     *
     * 흐름:
     *   1. designId로 NailDesign 조회 → 소유자 확인
     *   2. S3에서 원본 이미지 다운로드 → base64 변환
     *   3. gen 서버 /inpaint 호출 (동기)
     *   4. 응답 base64 → S3 업로드 (inpaint/{userId}/{designId}/{timestamp}.png)
     *   5. URL + base64 반환
     */
    @Transactional
    public InpaintResponseDto inpaint(User user, InpaintRequestDto request) {

        // 1. 디자인 조회 & 소유자 확인
        NailDesign design = nailDesignRepository.findById(request.getDesignId())
                .orElseThrow(() -> new IllegalArgumentException("디자인을 찾을 수 없습니다."));

        if (!design.getUser().getId().equals(user.getId())) {
            throw new IllegalArgumentException("본인의 디자인만 수정할 수 있습니다.");
        }

        if (design.getImageUrls() == null || design.getImageUrls().isEmpty()) {
            throw new IllegalStateException("디자인에 이미지가 없습니다.");
        }

        // 2. S3 → byte[] → base64
        String originalUrl = design.getImageUrls().get(0);
        byte[] originalBytes = s3Service.downloadImageBytes(originalUrl);
        String imageBase64 = Base64.getEncoder().encodeToString(originalBytes);

        // 3. gen 서버 호출
        Map<String, Object> genRequest = buildGenRequest(imageBase64, request);
        String resultBase64 = callGenServer(genRequest);

        // 4. S3 업로드
        String s3Key = String.format("inpaint/%d/%d/%d.png",
                user.getId(), design.getId(), System.currentTimeMillis());
        byte[] resultBytes = Base64.getDecoder().decode(resultBase64);
        String resultUrl = s3Service.uploadImageBytes(resultBytes, s3Key);

        return InpaintResponseDto.builder()
                .imageUrl(resultUrl)
                .imageBase64(resultBase64)
                .build();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ──────────────────────────────────────────────────────────────────────────

    private Map<String, Object> buildGenRequest(String imageBase64, InpaintRequestDto req) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("image_base64", imageBase64);
        body.put("prompt", req.getPrompt());
        body.put("nail_index", req.getNailIndex());
        body.put("strength", req.getStrength() != null ? req.getStrength() : 0.65f);
        if (req.getSeed() != null) {
            body.put("seed", req.getSeed());
        }
        return body;
    }

    private String callGenServer(Map<String, Object> requestBody) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);

        try {
            ResponseEntity<String> response = restTemplate.exchange(
                    genServerUrl + "/inpaint",
                    HttpMethod.POST,
                    entity,
                    String.class
            );
            return parseImageBase64(response.getBody());

        } catch (HttpStatusCodeException e) {
            // 400: nail_index 범위 초과 등 gen 서버가 detail로 이유 내려줌
            String detail = extractDetail(e.getResponseBodyAsString());
            throw new IllegalArgumentException("inpaint 요청 오류: " + detail);

        } catch (ResourceAccessException e) {
            throw new RuntimeException("gen 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해 주세요.");

        } catch (Exception e) {
            throw new RuntimeException("inpaint 처리 중 오류가 발생했습니다: " + e.getMessage());
        }
    }

    private String parseImageBase64(String responseBody) {
        try {
            JsonNode node = objectMapper.readTree(responseBody);
            String base64 = node.path("image_base64").asText(null);
            if (base64 == null || base64.isBlank()) {
                throw new RuntimeException("gen 서버 응답에 image_base64가 없습니다.");
            }
            return base64;
        } catch (Exception e) {
            throw new RuntimeException("gen 서버 응답 파싱 실패: " + e.getMessage());
        }
    }

    private String extractDetail(String responseBody) {
        try {
            return objectMapper.readTree(responseBody).path("detail").asText("알 수 없는 오류");
        } catch (Exception e) {
            return responseBody;
        }
    }
}