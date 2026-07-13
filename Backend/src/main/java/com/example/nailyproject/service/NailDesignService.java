package com.example.nailyproject.service;

import com.example.nailyproject.dto.request.DesignGenerateRequestDto;
import com.example.nailyproject.dto.request.UserPreferencesRequestDto;
import com.example.nailyproject.dto.response.DesignGenerateResponseDto;
import com.example.nailyproject.dto.response.DesignImageResponseDto;
import com.example.nailyproject.entity.*;
import com.example.nailyproject.repository.*;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.transaction.Transactional;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.http.*;

import java.util.*;
import java.util.stream.Collectors;
import java.time.format.DateTimeFormatter;

@Service
@Transactional
public class NailDesignService {

    private final NailDesignRepository nailDesignRepository;
    private final UserRepository userRepository;
    private final DesignSessionRepository designSessionRepository;
    private final HandScanRepository handScanRepository;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final S3Service s3Service;

//    ComfyUI URL을 공유받은 ngrok 주소로 변경 (기본적으로 작성되어있음)
    private static final String COMFY_URL = "https://scalded-lard-seduce.ngrok-free.dev";

    //  위한 카테고리별 허용 키워드 정의
    private static final Set<String> SHAPE_KEYWORDS = Set.of("almond", "round", "square", "stiletto", "ballerina", "oval");
    private static final Set<String> DESIGN_KEYWORDS = Set.of("glitter", "gradient", "cheek", "marble", "french", "magnetic", "powder", "matte", "art");
    private static final Set<String> MOOD_KEYWORDS = Set.of("lovely", "simple", "modern", "chic", "cute", "kitschy", "funky", "feminine", "elegant", "pure", "delicate");
    private static final Set<String> SEASON_KEYWORDS = Set.of("spring", "summer", "autumn", "winter");
    private static final Set<String> MOTIF_KEYWORDS = Set.of("star", "ribbon", "floral", "heart", "crystal", "pearl", "swirl", "polka dot");

    public NailDesignService(NailDesignRepository nailDesignRepository,
                             UserRepository userRepository,
                             DesignSessionRepository designSessionRepository,
                             HandScanRepository handScanRepository,
                             S3Service s3Service) {
        this.nailDesignRepository = nailDesignRepository;
        this.userRepository = userRepository;
        this.designSessionRepository = designSessionRepository;
        this.handScanRepository = handScanRepository;
        this.s3Service = s3Service;
        this.restTemplate = new RestTemplate();
        this.objectMapper = new ObjectMapper();
    }

    private HttpHeaders getHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("ngrok-skip-browser-warning", "true");
        return headers;
    }

    /**
     * 디자인 생성 요청 POST /designs/generate
     * sessionId, scanId 받아서 프롬프트 자동 생성 후 ComfyUI 호출
     */
    public DesignGenerateResponseDto generateDesignFromSession(User user, DesignGenerateRequestDto request) throws Exception {

        // 1. 세션 조회 (있으면)
        DesignSession session = null;
        if (request.getSessionId() != null) {
            session = designSessionRepository.findByIdAndUserId(request.getSessionId(), user.getId())
                    .orElseThrow(() -> new IllegalArgumentException("해당 채팅 세션을 찾을 수 없습니다."));
        }

        // 2. 스캔 조회 (필수)
        HandScan handScan = handScanRepository.findByIdAndUserId(request.getScanId(), user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 스캔을 찾을 수 없습니다."));

        // 3. 최종 프롬프트 생성
        String finalPrompt = buildFinalPrompt(session, handScan);

        // 4. 세션에 최종 프롬프트 저장
        if (session != null) {
            session.updateGeneratedPrompt(finalPrompt);
        }

        // 5. ComfyUI로 이미지 생성 및 DB 저장 (@Async 처리가 필요한 부분)
        NailDesign nailDesign = generateDesign(user.getId(), finalPrompt);

        return DesignGenerateResponseDto.builder()
                .designId(nailDesign.getId())
                .status(nailDesign.getStatus().name())
                .generatedPrompt(finalPrompt)
                .imageUrls(nailDesign.getImageUrls()) //DB에서 사진 3장 리스트를 꺼내서 DTO에 담기
                .build();
    }

//    ComfyUI로 이미지 생성 (기존 예서 코드)
    public NailDesign generateDesign(Long userId, String prompt) throws Exception {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found: " + userId));

        String clientId = UUID.randomUUID().toString();
        Map<String, Object> workflow = buildWorkflow(prompt);

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("prompt", workflow);
        requestBody.put("client_id", clientId);

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(requestBody, getHeaders());

        ResponseEntity<String> response = restTemplate.postForEntity(
                COMFY_URL + "/prompt", request, String.class
        );

        JsonNode responseJson = objectMapper.readTree(response.getBody());
        String promptId = responseJson.get("prompt_id").asText();

//        String imageUrl = waitForImage(promptId);
        // 1. 파이썬에게 임시 ngrok 주소 3개를 받아옴.
        List<String> ngrokUrls = waitForImage(promptId);

        // 2. S3 주소를 담을 새 바구니 준비
        List<String> s3Urls = new ArrayList<>();

        // 3. 3장의 이미지를 순회하며 백엔드로 다운로드 후 S3 업로드
        for (String ngrokUrl : ngrokUrls) {
            HttpEntity<Void> imageRequest = new HttpEntity<>(getHeaders());
            ResponseEntity<byte[]> imageResponse = restTemplate.exchange(
                    ngrokUrl, HttpMethod.GET, imageRequest, byte[].class
            );
            byte[] imageBytes = imageResponse.getBody();

            String s3Key = "designs/user_" + userId + "/" + UUID.randomUUID().toString() + ".png";
            String s3Url = s3Service.uploadImageBytes(imageBytes, s3Key);

            s3Urls.add(s3Url); // 완성된 S3 영구 주소를 바구니에 담기
        }

        NailDesign design = NailDesign.builder()
                .user(user)
                .imageUrls(s3Urls)
                .promptSummary(prompt)
                .aiModel("z-image-turbo + lora-v1")
                .status(NailDesign.DesignStatus.COMPLETED)
                .build();

        return nailDesignRepository.save(design);
    }

//    /**
//     * [독립 테스트용 Mockup] ComfyUI 외부 통신을 차단하고 로직 및 DB 정합성만 검증
//     */
//    public NailDesign generateDesign(Long userId, String prompt) throws Exception {
//        User user = userRepository.findById(userId)
//                .orElseThrow(() -> new RuntimeException("User not found: " + userId));
//
//        // 서버 콘솔에 정상 조립 완료된 프롬프트가 무엇인지 실시간 출력
//        System.out.println("\n==================================================================");
//        System.out.println("[Naily DB Test] 조립된 최종 프롬프트 문장:");
//        System.out.println(prompt);
//        System.out.println("==================================================================\n");
//
//        /* ─── 외부 ComfyUI API 통신 릴레이 및 스레드 블로킹 루프 차단 (주석 처리) ───
//        String clientId = UUID.randomUUID().toString();
//        Map<String, Object> workflow = buildWorkflow(prompt);
//
//        Map<String, Object> requestBody = new HashMap<>();
//        requestBody.put("prompt", workflow);
//        requestBody.put("client_id", clientId);
//
//        HttpEntity<Map<String, Object>> request = new HttpEntity<>(requestBody, getHeaders());
//
//        ResponseEntity<String> response = restTemplate.postForEntity(
//                COMFY_URL + "/prompt", request, String.class
//        );
//
//        JsonNode responseJson = objectMapper.readTree(response.getBody());
//        String promptId = responseJson.get("prompt_id").asText();
//
//        String imageUrl = waitForImage(promptId);
//        ───────────────────────────────────────────────────────────────────────────── */
//
//        // 타임아웃 없이 즉시 저장을 검증하기 위한 더미 S3/ngrok 가상 주소 바인딩
//        String mockImageUrl = COMFY_URL + "/view?filename=mock_test_naily_00001_.png&ngrok-skip-browser-warning=true";
//
//        // DB 인서트 객체 빌드
//        NailDesign design = NailDesign.builder()
//                .user(user)
//                .imageUrl(mockImageUrl)
//                .promptSummary(prompt)
//                .aiModel("z-image-turbo + lora-v1 (MOCK_ENV_TEST)")
//                .status(NailDesign.DesignStatus.DRAFT)
//                .build();
//
//        // 테이블 저장 후 영속성 데이터 반환
//        return nailDesignRepository.save(design);
//    }

    /**
     * 기획서의 STEP 2, STEP 4 반영한 프롬프트 조립 알고리즘
     */
    private String buildFinalPrompt(DesignSession session, HandScan handScan) {

        // 1. 선택지(UI) 파싱 - 1순위 데이터
        UserPreferencesRequestDto preferences = null;
        try {
            if (session != null && session.getExtractedPreferences() != null) {
                preferences = objectMapper.readValue(
                        session.getExtractedPreferences(), UserPreferencesRequestDto.class);
            }
        } catch (JsonProcessingException e) {
            System.err.println("선택지 파싱 에러");
        }

        // 2. 자유입력 키워드(JSON 배열) 파싱 - 2순위 데이터
        List<String> refineKeywords = new ArrayList<>();
        try {
            if (session != null && session.getRefineKeywords() != null) {
                JsonNode keywordsNode = objectMapper.readTree(session.getRefineKeywords());
                keywordsNode.forEach(k -> refineKeywords.add(k.asText().toLowerCase().trim()));
            }else {
                System.out.println("DB에 저장된 제미나이 키워드가 없음");
            }
        } catch (JsonProcessingException e) {
            System.err.println("자유입력 키워드 파싱 에러");
        }

        // 3. 자유입력 키워드 카테고리별 분류 (빈칸 채우기용)
        List<String> freeShapes = new ArrayList<>();
        List<String> freeDesigns = new ArrayList<>();
        List<String> freeMoods = new ArrayList<>();
        List<String> freeSeasons = new ArrayList<>();
        List<String> freeMotifs = new ArrayList<>();

        for (String keyword : refineKeywords) {
            if (SHAPE_KEYWORDS.contains(keyword)) freeShapes.add(keyword);
            else if (DESIGN_KEYWORDS.contains(keyword)) freeDesigns.add(keyword);
            else if (MOOD_KEYWORDS.contains(keyword)) freeMoods.add(keyword);
            else if (SEASON_KEYWORDS.contains(keyword)) freeSeasons.add(keyword);
            else if (MOTIF_KEYWORDS.contains(keyword)) freeMotifs.add(keyword);
        }

        //[슬롯 병합 시작] 선택지 우선, 없으면 자유입력, 없으면 기본값(분석값)

        // [슬롯 1] Shape (형태)
        String finalShape;
        if (preferences != null && preferences.getShape() != null && !preferences.getShape().isBlank()) {
            finalShape = preferences.getShape(); // 1순위: 선택지
        } else if (!freeShapes.isEmpty()) {
            finalShape = freeShapes.get(0);      // 2순위: 자유입력
        } else if (handScan.getShape() != null && !handScan.getShape().isBlank()) {
            finalShape = handScan.getShape();    // 3순위: 손분석 결과
        } else {
            finalShape = "round";                // 최후 기본값
        }

        // [슬롯 2] Design Type (선택지 없으면 자유 입력 채택 - 병합 X)
        List<String> finalDesigns = new ArrayList<>();
        if (preferences != null && preferences.getDesignType() != null && !preferences.getDesignType().isEmpty()) {
            finalDesigns.addAll(preferences.getDesignType()); // 선택지 우선
        } else {
            finalDesigns.addAll(freeDesigns);                 // 선택지 없으면 자유입력 채택
        }

        // [슬롯 3] Color (컬러)
        List<String> finalColors = new ArrayList<>();
        if (preferences != null && preferences.getColor() != null && !preferences.getColor().isEmpty()) {
            finalColors = preferences.getColor(); // 1순위: 선택지 (탭1 or 탭2)
        } else if (handScan.getRecommendedColors() != null) {
            try {
                // 3순위: 자동 분석된 추천 컬러 배열 파싱
                finalColors = objectMapper.readValue(handScan.getRecommendedColors(),
                        objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));
            } catch (JsonProcessingException e) {
                // 파싱 실패 시 공백 유지
            }
        }

        // [슬롯 4] Motif (+ 추가 모티프 병합)
        List<String> finalMotifs = new ArrayList<>();
        if (preferences != null && preferences.getMotif() != null && !preferences.getMotif().isEmpty() && !preferences.getMotif().contains("없음")) {
            finalMotifs.addAll(preferences.getMotif()); // 선택지 넣기
        }
        for (String m : freeMotifs) {
            if (!finalMotifs.contains(m)) finalMotifs.add(m); // 자유입력 중복 제외하고 병합
        }

        // [슬롯 5] Mood (+ 추가 무드 병합)
        List<String> finalMoods = new ArrayList<>();
        if (preferences != null && preferences.getMood() != null && !preferences.getMood().isEmpty()) {
            finalMoods.addAll(preferences.getMood()); // 선택지 넣기
        }
        for (String m : freeMoods) {
            if (!finalMoods.contains(m)) finalMoods.add(m); // 자유입력 중복 제외하고 병합
        }
        // [슬롯 6] Season (계절) - 선택우선 -> 자유입력
        String finalSeason = null;
        if (preferences != null && preferences.getSeason() != null && !preferences.getSeason().isBlank() && !preferences.getSeason().equals("상관없음")) {
            finalSeason = preferences.getSeason();
        } else if (!freeSeasons.isEmpty()) {
            finalSeason = freeSeasons.get(0);
        }
        // ─── [프롬프트 최종 조립 (안전한 List 결합 방식)] ───
        List<String> promptParts = new ArrayList<>();

        promptParts.add("nailart");
        promptParts.add(finalShape + " nail tips");

        if (!finalDesigns.isEmpty()) {
            promptParts.add(String.join(" ", finalDesigns) + " nail art");
        }

        if (!finalColors.isEmpty()) {
            List<String> limitedColors = finalColors.stream().limit(2).collect(Collectors.toList());
            promptParts.add(String.join(", ", limitedColors));
        }

        if (!finalMotifs.isEmpty()) {
            promptParts.add(String.join(" ", finalMotifs) + " nail art");
        }

        if (!finalMoods.isEmpty()) {
            promptParts.add(String.join(" ", finalMoods) + " mood");
        }

        if (finalSeason != null && !finalSeason.isBlank()) {
            promptParts.add(finalSeason + " season");
        }

        promptParts.add("korean nail art style");
        promptParts.add("product shot");
        promptParts.add("white background");
        promptParts.add("no hands");

        String finalPromptString = String.join(", ", promptParts);

        System.out.println("최종 완성 프롬프트: " + finalPromptString);
        System.out.println("--- [프롬프트 조립 종료] ---\n");

        return finalPromptString;

    }





    private List<String> waitForImage(String promptId) throws Exception {
        for (int i = 0; i < 60; i++) {
            Thread.sleep(1000);

            HttpEntity<Void> requestEntity = new HttpEntity<>(getHeaders());
            ResponseEntity<String> historyResponse = restTemplate.exchange(
                    COMFY_URL + "/history/" + promptId,
                    HttpMethod.GET,
                    requestEntity,
                    String.class
            );

            JsonNode history = objectMapper.readTree(historyResponse.getBody());

            if (history.has(promptId)) {
                JsonNode outputs = history.get(promptId).get("outputs");
                if (outputs != null && outputs.has("9")) {
                    JsonNode images = outputs.get("9").get("images");
                    // 3장의 이미지를 모두 리스트에 담아서 리턴하도록
                    if (images != null && images.size() > 0) {
                        List<String> imageUrls = new ArrayList<>();
                        for (JsonNode img : images) {
                            String filename = img.get("filename").asText();
                            imageUrls.add(COMFY_URL + "/view?filename=" + filename + "&ngrok-skip-browser-warning=true");
                        }
                        return imageUrls;
                    }
                }
            }
        }
        throw new RuntimeException("이미지 생성 타임아웃");
    }

    private Map<String, Object> buildWorkflow(String prompt) {
        Map<String, Object> workflow = new HashMap<>();

        workflow.put("3", Map.of(
                "inputs", Map.of(
                        "seed", (long)(Math.random() * Long.MAX_VALUE),
                        "steps", 30,
                        "cfg", 1,
                        "sampler_name", "euler",
                        "scheduler", "simple",
                        "denoise", 1,
                        "model", new Object[]{"19", 0},
                        "positive", new Object[]{"6", 0},
                        "negative", new Object[]{"7", 0},
                        "latent_image", new Object[]{"5", 0}
                ),
                "class_type", "KSampler"
        ));

        workflow.put("4", Map.of(
                "inputs", Map.of("ckpt_name", "z_image\\z_image_turbo_bf16.safetensors"),
                "class_type", "CheckpointLoaderSimple"
        ));

        workflow.put("5", Map.of(
                "inputs", Map.of("width", 768, "height", 512, "batch_size", 3),
                "class_type", "EmptyLatentImage"
        ));

        workflow.put("6", Map.of(
                "inputs", Map.of(
                        "text", prompt
                        ,
                        "clip", new Object[]{"16", 0}
                ),
                "class_type", "CLIPTextEncode"
        ));

        workflow.put("7", Map.of(
                "inputs", Map.of(
                        "text", "hands, fingers, skin, blurry, low quality, watermark, text, bad anatomy, deformed, ugly, dots, polka dot, stripes, dark colors, bold colors, tweezers, tools, props, gray background, colored background",
                        "clip", new Object[]{"16", 0}
                ),
                "class_type", "CLIPTextEncode"
        ));

        workflow.put("8", Map.of(
                "inputs", Map.of(
                        "samples", new Object[]{"3", 0},
                        "vae", new Object[]{"14", 0}
                ),
                "class_type", "VAEDecode"
        ));

        workflow.put("9", Map.of(
                "inputs", Map.of(
                        "filename_prefix", "naily",
                        "images", new Object[]{"8", 0}
                ),
                "class_type", "SaveImage"
        ));

        workflow.put("14", Map.of(
                "inputs", Map.of("vae_name", "ae.safetensors"),
                "class_type", "VAELoader"
        ));

        workflow.put("16", Map.of(
                "inputs", Map.of(
                        "clip_name", "z_image\\qwen_3_4b.safetensors",
                        "type", "lumina2",
                        "device", "default"
                ),
                "class_type", "CLIPLoader"
        ));

        workflow.put("19", Map.of(
                "inputs", Map.of(
                        "lora_name", "my_first_lora_v1.safetensors",
                        "strength_model", 0.8,
                        "strength_clip", 1.0,
                        "model", new Object[]{"4", 0},
                        "clip", new Object[]{"4", 1}
                ),
                "class_type", "LoraLoader"
        ));

        return workflow;
    }

    /**
     * '내 디자인' 전체 이미지 목록 조회 (각각의 이미지를 개별 아이템으로 펼쳐서 반환)
     */
    public List<DesignImageResponseDto> getUserDesignHistory(Long userId) {
        List<NailDesign> designs = nailDesignRepository.findAllByUserIdOrderByGeneratedAtDesc(userId);

        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy. M. d.");
        List<DesignImageResponseDto> resultList = new ArrayList<>();

        for (NailDesign design : designs) {
            String formattedDate = design.getGeneratedAt() != null
                    ? design.getGeneratedAt().format(formatter) : "";

            if (design.getImageUrls() != null) {
                for (String url : design.getImageUrls()) {
                    DesignImageResponseDto item = DesignImageResponseDto.builder()
                            .designId(design.getId())
                            .imageUrl(url)
                            .createdAt(formattedDate)
                            .build();
                    resultList.add(item);
                }
            }
        }
        return resultList;
    }

}
