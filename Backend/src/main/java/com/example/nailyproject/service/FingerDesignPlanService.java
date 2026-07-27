package com.example.nailyproject.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class FingerDesignPlanService {

    private final WebClient.Builder webClientBuilder;
    private final ObjectMapper objectMapper;

    @Value("${gemini.api.key}")
    private String apiKey;

    @Value("${gemini.api.url}")
    private String apiUrl;

    private static final String SYSTEM_PROMPT = """
            당신은 네일 3D 디자인 플래너입니다.
            아래 확정된 정보를 바탕으로 엄지(thumb)~소지(pinky) 5개 손가락의
            상세 디자인을 JSON으로 생성하세요. 참고 이미지가 함께 제공되면
            그 이미지의 스타일/파츠/배치를 최대한 반영하세요.
            "사용자가 특정 손가락(예: 엄지)에만 파츠나 디자인을 요청한 경우, 절대 AI 임의로 다른 손가락에 파츠를 추가하지 마세요. 언급되지 않은 손가락은 심플한 기본 디자인만 유지하세요."

            [중요] JSON 안의 모든 문자열 값(part_name 포함)은 반드시 영어로 작성하세요.
                    한국어를 절대 사용하지 마세요. part_name도 영어 짧은 구로 작성하세요.
                    예: "화이트 펄과 중앙에 리본" (X) -> "white pearl and ribbon in the middle" (O)
                        "실버 메탈 스터드" (X) -> "silver metal stud" (O)
            [규칙]
            - 5개 손가락은 통일감 있게 구성하되, 포인트가 되는 손가락 1~2개만 변주를 주세요.
            - 미입력 항목은 주어진 mood/season/color에 어울리게 자유롭게 확장해서 채우세요.
              (정보가 최소한만 있어도 완전한 디자인을 만들어야 합니다)
            - part_name은 자유 텍스트입니다 (예: "리본 장식", "펄 스터드").
            - position은 [x, y], 0~1로 정규화된 손톱 표면 상대 좌표
              (0,0=손톱 왼쪽 아래, 1,1=오른쪽 위).
            - size_ratio_to_nail_width: 손톱 폭 대비 파츠의 상대 크기 (0~1). 절대 mm를 모르니
              반드시 비율로만 정하세요.
            - aspect_ratio: 파츠의 가로:세로 비율 (1.0=정사각형, 값이 작을수록 세로로 긴 형태).
            - attach_flat_base: 이 파츠가 손톱에 물리적으로 부착되면 true.
            - primitives[].op는 반드시 다음 중에서만 선택: extrude_outline, sphere_dome, cone, cylinder
            - primitives[].outline_type은 op가 extrude_outline일 때만 사용 (예: loop_left, loop_right)
            - primitives[].material은 pearl, metal, matte, glossy 중에서 선택하세요.
            - primitives 내부 치수는 thickness_mm / height_mm / diameter_mm / radius_ratio 등
              실측 mm 또는 상대 비율을 상황에 맞게 사용하세요.
            - motif나 파츠가 필요 없는 손가락은 motif를 "none", parts는 빈 배열로 두세요.
            - base_color는 hex 코드로 작성하세요.

            [확정된 입력 정보]
            %s

            반드시 아래 JSON 형식으로만 응답하세요. 마크다운 없이 순수 JSON만 반환합니다.
            {
              "shape": "", "mood": "", "season": "",
              "thumb": {
                "design_type": "...", "base_color": "...", "motif": "...",
                "parts": [{
                  "part_name": "...", "position": [0.5, 0.22], "rotation_deg": 0,
                  "size_ratio_to_nail_width": 0.55, "aspect_ratio": 0.75,
                  "attach_flat_base": true,
                  "primitives": [{
                    "op": "extrude_outline", "outline_type": "loop_left",
                    "width_ratio": 0.6, "height_ratio": 0.45,
                    "thickness_mm": 1.4, "color": "#E8E4F0", "material": "pearl"
                  }]
                }]
              },
              "index": { ... }, "middle": { ... }, "ring": { ... }, "pinky": { ... }
            }
            """;

    /**
     * 참고 이미지 없이 플랜 생성
     */
    public JsonNode generatePlan(String confirmedInputSummary) {
        return generatePlan(confirmedInputSummary, null, null);
    }

    /**
     * 참고 이미지(base64)와 함께 플랜 생성
     * @param imageBase64  base64로 인코딩된 이미지 (없으면 null)
     * @param imageMimeType 예: "image/jpeg", "image/png"
     */
    public JsonNode generatePlan(String confirmedInputSummary, String imageBase64, String imageMimeType) {

        String systemPrompt = String.format(SYSTEM_PROMPT, confirmedInputSummary);

        List<Map<String, Object>> parts = new ArrayList<>();
        if (imageBase64 != null && imageMimeType != null) {
            parts.add(Map.of(
                    "inline_data", Map.of(
                            "mime_type", imageMimeType,
                            "data", imageBase64
                    )
            ));
            parts.add(Map.of("text", "이 참고 이미지의 스타일과 파츠 배치를 반영해서 위 정보로 5개 손가락 디자인을 생성해주세요."));
        } else {
            parts.add(Map.of("text", "위 정보로 5개 손가락 디자인을 생성해주세요."));
        }

        Map<String, Object> requestBody = Map.of(
                "contents", List.of(Map.of("role", "user", "parts", parts)),
                "systemInstruction", Map.of("parts", List.of(Map.of("text", systemPrompt))),
                "generationConfig", Map.of("responseMimeType", "application/json")
        );

        JsonNode responseNode = webClientBuilder.build().post()
                .uri(apiUrl + "?key=" + apiKey.trim())
                .bodyValue(requestBody)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .block();

        String text = responseNode.path("candidates").get(0)
                .path("content").path("parts").get(0).path("text").asText();

        try {
            return objectMapper.readTree(text);
        } catch (Exception e) {
            throw new RuntimeException("디자인 플랜 JSON 파싱 실패", e);
        }
    }
}
