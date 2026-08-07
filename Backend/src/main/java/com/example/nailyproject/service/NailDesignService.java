package com.example.nailyproject.service;

import com.example.nailyproject.dto.PromptResult;
import com.example.nailyproject.dto.SlotData;
import com.example.nailyproject.dto.request.DesignGenerateRequestDto;
import com.example.nailyproject.dto.response.DesignGenerateResponseDto;
import com.example.nailyproject.dto.response.DesignImageResponseDto;
import com.example.nailyproject.dto.response.CommunityDesignResponseDto;
import com.example.nailyproject.entity.*;
import com.example.nailyproject.repository.*;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.transaction.Transactional;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.http.*;
import org.springframework.web.reactive.function.client.WebClient;
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
    private final SavedDesignRepository savedDesignRepository;
    private final FingerDesignPlanService fingerDesignPlanService;
    private final WebClient.Builder webClientBuilder;
    private final ColorNameService colorNameService;

    //    ComfyUI URL을 공유받은 ngrok 주소로 변경 (기본적으로 작성되어있음)
    private static final String COMFY_URL = "https://scalded-lard-seduce.ngrok-free.dev";

    private static final String BASE_NEGATIVE_PROMPT =
            "hands, fingers, skin, blurry, low quality, watermark, text, bad anatomy, deformed, ugly, dots, polka dot, stripes, dark colors, bold colors, tweezers, tools, props, gray background, colored background";

    @org.springframework.beans.factory.annotation.Value("${analysis.server.url:http://localhost:8000}")
    private String analysisServerUrl;

    public NailDesignService(NailDesignRepository nailDesignRepository,
                             UserRepository userRepository,
                             DesignSessionRepository designSessionRepository,
                             HandScanRepository handScanRepository,
                             S3Service s3Service,
                             SavedDesignRepository savedDesignRepository,
                             FingerDesignPlanService fingerDesignPlanService,
                             WebClient.Builder webClientBuilder,
                             ColorNameService colorNameService) {
        this.nailDesignRepository = nailDesignRepository;
        this.userRepository = userRepository;
        this.designSessionRepository = designSessionRepository;
        this.handScanRepository = handScanRepository;
        this.s3Service = s3Service;
        this.savedDesignRepository = savedDesignRepository;
        this.fingerDesignPlanService = fingerDesignPlanService;
        this.webClientBuilder = webClientBuilder;
        this.colorNameService = colorNameService;
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

        // 3. 최종 프롬프트 생성 (프롬프트 + negative를 함께 조립)
        PromptResult promptResult = buildFinalPrompt(session, handScan);

        // 4. 세션에 최종 프롬프트 저장
        if (session != null) {
            session.updateGeneratedPrompt(promptResult.prompt());
        }

        // 5. ComfyUI로 이미지 생성 및 DB 저장 (세션 연결 포함)
        NailDesign nailDesign = generateDesign(user.getId(), promptResult.prompt(), promptResult.negativePrompt(), session);

        return DesignGenerateResponseDto.builder()
                .designId(nailDesign.getId())
                .status(nailDesign.getStatus().name())
                .generatedPrompt(promptResult.prompt())
                .imageUrls(nailDesign.getImageUrls())
                .build();
    }

    /**
     * ComfyUI로 이미지 생성 (세션 연결 없이 - 하위 호환용)
     */
    public NailDesign generateDesign(Long userId, String prompt, String negativePrompt) throws Exception {
        return generateDesign(userId, prompt, negativePrompt, null);
    }

    /**
     * ComfyUI로 이미지 생성 (세션 연결 포함)
     */
    public NailDesign generateDesign(Long userId, String prompt, String negativePrompt, DesignSession session) throws Exception {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found: " + userId));

        String clientId = UUID.randomUUID().toString();
        Map<String, Object> workflow = buildWorkflow(prompt, negativePrompt);

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("prompt", workflow);
        requestBody.put("client_id", clientId);

        Map<String, Object> generationConfig = new HashMap<>();
        generationConfig.put("responseMimeType", "application/json");

        // 조립한 config를 requestBody에 추가
        requestBody.put("generationConfig", generationConfig);

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(requestBody, getHeaders());

        ResponseEntity<String> response = restTemplate.postForEntity(
                COMFY_URL + "/prompt", request, String.class
        );

        JsonNode responseJson = objectMapper.readTree(response.getBody());
        String promptId = responseJson.get("prompt_id").asText();

        // 1. 파이썬에게 임시 ngrok 주소를 받아옴 (batch_size=1 기준 1장)
        List<String> ngrokUrls = waitForImage(promptId);

        // 2. S3 주소를 담을 새 바구니 준비
        List<String> s3Urls = new ArrayList<>();

        // 3. 이미지를 순회하며 백엔드로 다운로드 후 S3 업로드
        for (String ngrokUrl : ngrokUrls) {
            HttpEntity<Void> imageRequest = new HttpEntity<>(getHeaders());
            ResponseEntity<byte[]> imageResponse = restTemplate.exchange(
                    ngrokUrl, HttpMethod.GET, imageRequest, byte[].class
            );
            byte[] imageBytes = imageResponse.getBody();

            String s3Key = "designs/user_" + userId + "/" + UUID.randomUUID().toString() + ".png";
            String s3Url = s3Service.uploadImageBytes(imageBytes, s3Key);

            s3Urls.add(s3Url);
        }

        NailDesign design = NailDesign.builder()
                .user(user)
                .session(session)
                .imageUrls(s3Urls)
                .promptSummary(prompt)
                .aiModel("z-image-turbo + lora-v1")
                .status(NailDesign.DesignStatus.COMPLETED)
                .build();

        return nailDesignRepository.save(design);
    }

    //단어사이 하이픈 제거용
    private String toPromptText(String value) {
        return value.replace("-", " ");
    }

    /**
     * 슬롯(SlotData) 기반 최종 프롬프트 조립
     * liked -> 긍정 프롬프트에 반영, disliked -> negative 프롬프트에 반영
     */
    private PromptResult buildFinalPrompt(DesignSession session, HandScan handScan) {

        Map<String, SlotData> slots = new HashMap<>();
        try {
            if (session != null && session.getExtractedPreferences() != null) {
                slots = objectMapper.readValue(
                        session.getExtractedPreferences(),
                        objectMapper.getTypeFactory().constructMapType(HashMap.class, String.class, SlotData.class)
                );
            }
        } catch (JsonProcessingException e) {
            System.err.println("슬롯 파싱 에러");
        }

        List<String> shapeLiked = getLiked(slots, "shape");
        String finalShape;
        if (!shapeLiked.isEmpty()) {
            finalShape = shapeLiked.get(0);
        } else if (handScan.getShape() != null && !handScan.getShape().isBlank()) {
            finalShape = handScan.getShape();
        } else {
            finalShape = "round";
        }

        List<String> finalDesigns = getLiked(slots, "designType");

        List<String> finalColors = getLiked(slots, "color");
        if (finalColors.isEmpty() && handScan.getRecommendedColors() != null) {
            try {
                finalColors = objectMapper.readValue(handScan.getRecommendedColors(),
                        objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));
            } catch (JsonProcessingException ignored) {
            }
        }

        List<String> finalMotifs = getLiked(slots, "motif");
        List<String> finalMoods = getLiked(slots, "mood");

        List<String> seasonLiked = getLiked(slots, "season");
        List<String> finalSeasons = seasonLiked.stream()
                .filter(s -> !"none".equalsIgnoreCase(s))
                .limit(2)
                .toList();

        List<String> promptParts = new ArrayList<>();
        promptParts.add("nailart");
        promptParts.add(finalShape + " nail tips");

        if (!finalDesigns.isEmpty()) {
            promptParts.add(finalDesigns.stream()
                    .map(this::toPromptText)
                    .collect(Collectors.joining(" ")) + " nail art");
        }
        if (!finalColors.isEmpty()) {
            List<String> limitedColors = finalColors.stream()
                    .limit(2)
                    .map(this::toPromptText)
                    .collect(Collectors.toList());
            promptParts.add(String.join(", ", limitedColors));
        }
        if (!finalMotifs.isEmpty()) {
            promptParts.add(finalMotifs.stream()
                    .map(this::toPromptText)
                    .collect(Collectors.joining(" ")) + " nail art");
        }
        if (!finalMoods.isEmpty()) {
            promptParts.add(finalMoods.stream()
                    .map(this::toPromptText)
                    .collect(Collectors.joining(" ")) + " mood");
        }
        if (!finalSeasons.isEmpty()) {
            promptParts.add(finalSeasons.stream()
                    .map(this::toPromptText)
                    .collect(Collectors.joining(", ")) + " theme");
        }

        promptParts.add("korean nail art style, product shot, white background, no hands, isolated nail tips, floating nails, disembodied nails");

        String finalPromptString = String.join(", ", promptParts);

        List<String> allDisliked = new ArrayList<>();
        for (SlotData s : slots.values()) {
            if (s.getDisliked() != null) {
                allDisliked.addAll(s.getDisliked());
            }
        }

        String finalNegative = allDisliked.isEmpty()
                ? BASE_NEGATIVE_PROMPT
                : BASE_NEGATIVE_PROMPT + ", " + String.join(", ", allDisliked);

        System.out.println("최종 완성 프롬프트: " + finalPromptString);
        System.out.println("최종 negative 프롬프트: " + finalNegative);
        System.out.println("--- [프롬프트 조립 종료] ---\n");

        return new PromptResult(finalPromptString, finalNegative);
    }

    private List<String> getLiked(Map<String, SlotData> slots, String category) {
        SlotData s = slots.get(category);
        return (s != null && s.getLiked() != null) ? s.getLiked() : new ArrayList<>();
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

    private Map<String, Object> buildWorkflow(String prompt, String negativePrompt) {
        Map<String, Object> workflow = new HashMap<>();

        workflow.put("3", Map.of(
                "inputs", Map.of(
                        "seed", (long) (Math.random() * Long.MAX_VALUE),
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
                "inputs", Map.of("width", 768, "height", 512, "batch_size", 1),
                "class_type", "EmptyLatentImage"
        ));

        workflow.put("6", Map.of(
                "inputs", Map.of(
                        "text", prompt,
                        "clip", new Object[]{"16", 0}
                ),
                "class_type", "CLIPTextEncode"
        ));

        workflow.put("7", Map.of(
                "inputs", Map.of(
                        "text", negativePrompt,
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
     * sessionId, promptSummary도 함께 내려줘서 마이페이지에서 "이 디자인은 이런 취향으로 만들어졌어요"를 보여줄 수 있음
     */
    public List<DesignImageResponseDto> getUserDesignHistory(Long userId) {
        List<NailDesign> designs = nailDesignRepository.findAllByUserIdOrderByGeneratedAtDesc(userId);

        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy. M. d.");
        List<DesignImageResponseDto> resultList = new ArrayList<>();

        for (NailDesign design : designs) {
            String formattedDate = design.getGeneratedAt() != null
                    ? design.getGeneratedAt().format(formatter) : "";
            Long sessionId = design.getSession() != null ? design.getSession().getId() : null;

            if (design.getImageUrls() != null) {
                for (String url : design.getImageUrls()) {
                    DesignImageResponseDto item = DesignImageResponseDto.builder()
                            .designId(design.getId())
                            .sessionId(sessionId)
                            .imageUrl(url)
                            .promptSummary(design.getPromptSummary())
                            .createdAt(formattedDate)
                            .build();
                    resultList.add(item);
                }
            }
        }
        return resultList;
    }

    /**
     * '둘러보기' 커뮤니티 갤러리 GET /designs/community
     * 전체 사용자가 생성한 디자인 중 완성된(COMPLETED) 것만 최신순으로 모아서 반환.
     * 디자인 1건당 대표 이미지 1장(첫 번째 이미지)만 사용.
     */
    public List<CommunityDesignResponseDto> getCommunityGallery() {
        List<NailDesign> designs =
                nailDesignRepository.findTop60ByStatusOrderByGeneratedAtDesc(NailDesign.DesignStatus.COMPLETED);

        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy. M. d.");
        List<CommunityDesignResponseDto> resultList = new ArrayList<>();

        for (NailDesign design : designs) {
            if (design.getImageUrls() == null || design.getImageUrls().isEmpty()) continue;

            String formattedDate = design.getGeneratedAt() != null
                    ? design.getGeneratedAt().format(formatter) : "";

            resultList.add(CommunityDesignResponseDto.builder()
                    .designId(design.getId())
                    .imageUrl(design.getImageUrls().get(0))
                    .createdAt(formattedDate)
                    .build());
        }
        return resultList;
    }

    /**
     * 디자인 완전 삭제 DELETE /designs/{designId}
     */
    @Transactional
    public void deleteDesign(User user, Long designId) {
        NailDesign design = nailDesignRepository.findById(designId)
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 디자인입니다."));

        if (!design.getUser().getId().equals(user.getId())) {
            throw new IllegalArgumentException("본인의 디자인만 삭제할 수 있습니다.");
        }

        savedDesignRepository.deleteAllByNailDesign(design);

        if (design.getImageUrls() != null) {
            for (String imageUrl : design.getImageUrls()) {
                s3Service.deleteFile(imageUrl);
            }
        }

        nailDesignRepository.delete(design);
    }

    /**
     * [상세 디자인 생성] STEP1~4 오케스트레이션, ComfyUI 1회 호출
     * POST /designs/generate-detailed
     */
    public DesignGenerateResponseDto generateDetailedDesign(User user, DesignGenerateRequestDto request) throws Exception {
        return generateDetailedDesignInternal(user, request, null, null);
    }

    /**
     * [상세 디자인 생성 + 참고 이미지]
     * POST /designs/generate-detailed-from-image
     */
    public DesignGenerateResponseDto generateDetailedDesignFromImage(
            User user, DesignGenerateRequestDto request, String imageBase64, String imageMimeType) throws Exception {
        return generateDetailedDesignInternal(user, request, imageBase64, imageMimeType);
    }

    private DesignGenerateResponseDto generateDetailedDesignInternal(
            User user, DesignGenerateRequestDto request, String imageBase64, String imageMimeType) throws Exception {

        DesignSession session = null;
        Map<String, SlotData> slots = new HashMap<>();
        if (request.getSessionId() != null) {
            session = designSessionRepository.findByIdAndUserId(request.getSessionId(), user.getId())
                    .orElseThrow(() -> new IllegalArgumentException("해당 채팅 세션을 찾을 수 없습니다."));
            if (session.getExtractedPreferences() != null) {
                try {
                    slots = objectMapper.readValue(session.getExtractedPreferences(),
                            objectMapper.getTypeFactory().constructMapType(HashMap.class, String.class, SlotData.class));
                } catch (Exception e) {
                    // 다른 흐름(예: 예전 선택지 저장 방식)에서 저장된 형식과 안 맞을 수 있으므로,
                    // 전체 생성이 죽지 않도록 빈 슬롯으로 폴백
                    System.err.println("extractedPreferences 파싱 실패, 빈 슬롯으로 진행: "
                            + session.getExtractedPreferences());
                    slots = new HashMap<>();
                }
            }
        }

        // 스캔 조회 (선택 - 없어도 생성 가능)
        HandScan handScan = null;
        if (request.getScanId() != null) {
            handScan = handScanRepository.findByIdAndUserId(request.getScanId(), user.getId())
                    .orElse(null);
        }

        fillMissingFromScan(slots, handScan);

        if (session != null) {
            session.updateExtractedPreferences(objectMapper.writeValueAsString(slots));
        }

        String summary = summarizeSlots(slots, handScan)
                + buildFingerInstructionText(session != null ? session.getFingerOverrides() : null)
                + buildFingerDislikeInstructionText(session != null ? session.getFingerDislikes() : null);
        JsonNode plan = fingerDesignPlanService.generatePlan(summary, imageBase64, imageMimeType);

        // 사진 기반 생성 등으로 슬롯이 비어있던 카테고리를, 방금 나온 plan 결과값으로 역채움.
        // 이걸 안 하면 이후 자유입력 채팅이 "슬롯이 텅 비어있다"고 판단해서
        // mood/color 등을 처음부터 다시 인터뷰하듯 물어보게 된다.
        if (session != null) {
            backfillSlotsFromPlan(slots, plan);
            session.updateExtractedPreferences(objectMapper.writeValueAsString(slots));
        }

        List<String> allDisliked = new ArrayList<>();
        for (SlotData s : slots.values()) {
            if (s.getDisliked() != null) allDisliked.addAll(s.getDisliked());
        }
        // disliked 항목은 이제 별도 negative 채널이 아니라, "no X" 문구로 긍정 프롬프트 안에 합쳐서 넣는다.
        List<String> noPhrases = new ArrayList<>();
        for (Map.Entry<String, SlotData> entry : slots.entrySet()) {
            String category = entry.getKey();
            List<String> disliked = entry.getValue().getDisliked();
            if (disliked == null || disliked.isEmpty()) continue;

            if ("color".equals(category)) {
                // color의 disliked도 hex -> 이름으로 변환해서 "no X"로 만든다
                List<String> resolvedNames = colorNameService.resolveColorNames(disliked);
                resolvedNames.forEach(name -> noPhrases.add("no " + name));
            } else {
                disliked.forEach(d -> noPhrases.add("no " + toPromptText(d)));
            }
        }

        String finalNegative = BASE_NEGATIVE_PROMPT; // ComfyUI negative 채널은 기본 품질 관련 값만 유지

        Map<String, List<String>> fingerDislikesMap = new HashMap<>();
        if (session != null && session.getFingerDislikes() != null && !session.getFingerDislikes().isBlank()) {
            try {
                JsonNode dislikesNode = objectMapper.readTree(session.getFingerDislikes());
                dislikesNode.fields().forEachRemaining(entry -> {
                    List<String> items = new ArrayList<>();
                    entry.getValue().forEach(v -> items.add(v.asText()));
                    fingerDislikesMap.put(entry.getKey(), items);
                });
            } catch (Exception ignored) {
            }
        }

        String combinedPrompt = buildCombinedPromptFromPlan(plan, noPhrases, fingerDislikesMap);

        if (session != null) {
            session.updateGeneratedPrompt(combinedPrompt);
        }

        // ComfyUI 1회 호출 (세션 연결 포함)
        NailDesign nailDesign = generateDesign(user.getId(), combinedPrompt, finalNegative, session);

        nailDesign.updateDesignPlan(plan.toString());
        nailDesignRepository.save(nailDesign);

        sendPlanToPartsGenerator(user.getId(), handScan != null ? handScan.getId() : null, nailDesign.getId(), plan);

        return DesignGenerateResponseDto.builder()
                .designId(nailDesign.getId())
                .status(nailDesign.getStatus().name())
                .generatedPrompt(combinedPrompt)
                .imageUrls(nailDesign.getImageUrls())
                .build();
    }

    private void fillMissingFromScan(Map<String, SlotData> slots, HandScan handScan) {
        if (handScan == null) {
            // 스캔 정보가 없으면 mood 정도만 기본값으로 채워서 진행
            if (getLiked(slots, "mood").isEmpty()) {
                String designType = getLiked(slots, "designType").isEmpty() ? null : getLiked(slots, "designType").get(0);
                String defaultMood = ("glitter".equals(designType) || "marble".equals(designType)) ? "chic" : "simple";
                addLiked(slots, "mood", defaultMood);
            }
            return;
        }

        if (getLiked(slots, "shape").isEmpty() && handScan.getShape() != null && !handScan.getShape().isBlank()) {
            addLiked(slots, "shape", handScan.getShape());
        }

        if (getLiked(slots, "color").isEmpty() && handScan.getRecommendedColors() != null) {
            try {
                List<String> palette = objectMapper.readValue(handScan.getRecommendedColors(),
                        objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));
                if (!palette.isEmpty()) {
                    String randomColor = palette.get(new Random().nextInt(palette.size()));
                    addLiked(slots, "color", randomColor);
                }
            } catch (JsonProcessingException ignored) {
            }
        }

        if (getLiked(slots, "mood").isEmpty()) {
            String designType = getLiked(slots, "designType").isEmpty() ? null : getLiked(slots, "designType").get(0);
            String defaultMood = ("glitter".equals(designType) || "marble".equals(designType)) ? "chic" : "simple";
            addLiked(slots, "mood", defaultMood);
        }
    }

    private void addLiked(Map<String, SlotData> slots, String category, String value) {
        SlotData slot = slots.computeIfAbsent(category, k -> new SlotData());
        if (!slot.getLiked().contains(value)) slot.getLiked().add(value);
    }

    /**
     * fingerDesignPlanService.generatePlan()이 만든 plan(JSON)의 top-level 값
     * (shape/mood/season/color/designType/motif)을, 아직 비어있는 슬롯 카테고리에만
     * 채워 넣는다. 이미 값이 있는 카테고리는 건드리지 않는다(사용자가 직접 고른 값이
     * 있으면 그게 우선).
     */
    private void backfillSlotsFromPlan(Map<String, SlotData> slots, JsonNode plan) {
        backfillOne(slots, "shape", plan);
        backfillOne(slots, "mood", plan);
        backfillOne(slots, "season", plan);
        backfillOne(slots, "color", plan);
        backfillOne(slots, "designType", plan);
        backfillOne(slots, "motif", plan);
    }

    private void backfillOne(Map<String, SlotData> slots, String category, JsonNode plan) {
        boolean alreadyFilled = slots.containsKey(category) && !slots.get(category).getLiked().isEmpty();
        if (alreadyFilled) return;

        JsonNode valueNode = plan.path(category);
        if (valueNode.isMissingNode() || valueNode.asText().isBlank()) return;
        if ("none".equalsIgnoreCase(valueNode.asText())) return;

        addLiked(slots, category, valueNode.asText());
    }

    private String buildFingerInstructionText(String fingerOverridesJson) {
        if (fingerOverridesJson == null || fingerOverridesJson.isBlank()) return "";
        try {
            JsonNode overrides = objectMapper.readTree(fingerOverridesJson);
            StringBuilder sb = new StringBuilder("\n[사용자가 명시적으로 지정한 손가락별 디자인 - 반드시 그대로 반영]\n");
            overrides.fields().forEachRemaining(entry -> {
                sb.append(entry.getKey()).append(": ").append(entry.getValue().asText()).append("\n");
            });
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private String buildFingerDislikeInstructionText(String fingerDislikesJson) {
        if (fingerDislikesJson == null || fingerDislikesJson.isBlank()) return "";
        try {
            JsonNode dislikes = objectMapper.readTree(fingerDislikesJson);
            StringBuilder sb = new StringBuilder("\n[사용자가 명시적으로 지정한 손가락별 비선호 - 절대 반영 금지]\n");
            dislikes.fields().forEachRemaining(entry -> {
                List<String> items = new ArrayList<>();
                entry.getValue().forEach(v -> items.add(v.asText()));
                sb.append(entry.getKey()).append(": ").append(String.join(", ", items)).append(" 절대 사용 금지\n");
            });
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private String summarizeSlots(Map<String, SlotData> slots, HandScan handScan) {
        StringBuilder sb = new StringBuilder();
        for (String cat : List.of("shape", "mood", "designType", "color", "season", "motif")) {
            List<String> liked = getLiked(slots, cat);
            if (!liked.isEmpty()) {
                if ("color".equals(cat)) {
                    // hex -> 영어 이름 변환은 Gemini의 추측이 아니라 ColorNameService(외부 API + 로컬 폴백)로 확정
                    List<String> resolvedNames = colorNameService.resolveColorNames(liked).stream()
                            .distinct()
                            .toList();
                    sb.append("color(이미 확정된 값, 절대 다른 이름으로 바꾸지 말고 그대로 사용): ")
                            .append(String.join(", ", resolvedNames)).append("\n");
                } else {
                    sb.append(cat).append(": ").append(String.join(", ", liked)).append("\n");
                }
            }
            List<String> disliked = slots.containsKey(cat) ? slots.get(cat).getDisliked() : List.of();
            if (disliked != null && !disliked.isEmpty()) {
                sb.append(cat).append(" (피해야 함): ").append(String.join(", ", disliked)).append("\n");
            }
        }

        if (getLiked(slots, "color").isEmpty() && handScan != null && handScan.getRecommendedColors() != null) {
            try {
                List<String> palette = objectMapper.readValue(handScan.getRecommendedColors(),
                        objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));
                if (!palette.isEmpty()) {
                    // 퍼스널컬러 후보도 hex 그대로 넘기지 않고, 이름으로 변환해서 후보로 제시
                    List<String> resolvedPalette = colorNameService.resolveColorNames(palette);
                    sb.append("color 후보(사용자의 퍼스널컬러 기반 추천 팔레트, 이 중에서 mood와 가장 잘 어울리는 것을 선택): ")
                            .append(String.join(", ", resolvedPalette)).append("\n");
                }
            } catch (JsonProcessingException ignored) {
            }
        }

        return sb.toString();
    }

    private String buildCombinedPromptFromPlan(JsonNode plan, List<String> noPhrases, Map<String, List<String>> fingerDislikesMap) {
        String shape = toPromptText(plan.path("shape").asText("round"));
        String mood = plan.path("mood").asText("");
        String season = plan.path("season").asText("");
        String overallColor = plan.path("color").asText("");
        String overallDesignType = plan.path("designType").asText("");
        String overallMotif = plan.path("motif").asText("");

        List<String> parts = new ArrayList<>();
        parts.add("A studio product photo of five " + shape + "-shaped press-on nail tips arranged in a perfectly straight horizontal line with equal spacing between each tip");
        parts.add("nailart");

        if (!overallDesignType.isBlank()) {
            parts.add(toPromptText(overallDesignType));
        }
        if (!overallColor.isBlank()) {
            parts.add(toPromptText(overallColor) + " base color");
        }
        if (!overallMotif.isBlank() && !"none".equalsIgnoreCase(overallMotif)) {
            parts.add(toPromptText(overallMotif) + " motif");
        }

        for (String fingerName : List.of("thumb", "index", "middle", "ring", "pinky")) {
            JsonNode finger = plan.get(fingerName);
            if (finger == null) continue;
            List<String> fingerDislikes = fingerDislikesMap.getOrDefault(fingerName, List.of());
            String desc = describeFingerForPrompt(fingerName, finger, fingerDislikes);
            if (desc != null) {
                parts.add(desc);
            }
        }

        if (!mood.isBlank()) parts.add(toPromptText(mood) + " mood");
        if (!season.isBlank() && !"none".equalsIgnoreCase(season)) parts.add(toPromptText(season));

        if (!noPhrases.isEmpty()) {
            parts.add(String.join(", ", noPhrases));
        }

        parts.add("top-down flat lay view");
        parts.add("plain white background");
        parts.add("no shadow, no hands, no fingers, no text, no watermark");
        parts.add("product shot");

        String result = String.join(", ", parts);
        System.out.println("최종 완성 프롬프트(통합): " + result);
        return result;
    }

    private String describeFingerForPrompt(String fingerName, JsonNode finger, List<String> fingerDislikes) {
        String designType = finger.path("design_type").asText("");
        String baseColor = finger.path("base_color").asText("");
        String motif = finger.path("motif").asText("none");
        JsonNode partsList = finger.get("parts");
        boolean hasParts = partsList != null && partsList.isArray() && partsList.size() > 0;

        // 지정된 게 아무것도 없으면 이 손가락은 프롬프트에서 아예 생략
        boolean isEmpty = designType.isBlank() && baseColor.isBlank()
                && ("none".equalsIgnoreCase(motif)) && !hasParts && fingerDislikes.isEmpty();
        if (isEmpty) return null;

        List<String> descriptors = new ArrayList<>();
        if (!designType.isBlank()) descriptors.add(toPromptText(designType));
        if (!baseColor.isBlank()) descriptors.add(toPromptText(baseColor));

        if (hasParts) {
            List<String> partTags = new ArrayList<>();
            partsList.forEach(p -> partTags.add(toPromptText(p.asText())));
            descriptors.add("with " + String.join(" and ", partTags));
        } else if (!"none".equalsIgnoreCase(motif)) {
            descriptors.add("with " + toPromptText(motif));
        }

        String base = fingerName + " features " + String.join(" ", descriptors);

        if (!fingerDislikes.isEmpty()) {
            String withoutPart = fingerDislikes.stream()
                    .map(this::toPromptText)
                    .collect(Collectors.joining(" or "));
            base = base + " without " + withoutPart;
        }

        return base;
    }

    /**
     * 출력 B: 손가락별 상세 JSON을 파이썬 파츠 3D 생성기로 전달.
     * [API 계약 - 아직 파이썬 쪽 미구현]
     *   POST {analysisServerUrl}/generate/parts-from-plan
     *   body: { "userId": Long, "scanId": Long, "designId": Long, "plan": <STEP3 JSON 그대로> }
     */
    private void sendPlanToPartsGenerator(Long userId, Long scanId, Long designId, JsonNode plan) {
        try {
            Map<String, Object> body = new HashMap<>();
            body.put("userId", userId);
            body.put("scanId", scanId); // null일 수 있음 (스캔 없이 생성한 경우)
            body.put("designId", designId);
            body.put("plan", plan);

            webClientBuilder.build().post()
                    .uri(analysisServerUrl + "/generate/parts-from-plan")
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(Void.class)
                    .doOnError(e -> System.err.println("파츠 생성기 호출 실패(미구현 상태일 수 있음): " + e.getMessage()))
                    .onErrorResume(e -> reactor.core.publisher.Mono.empty())
                    .subscribe();
        } catch (Exception e) {
            System.err.println("파츠 생성기 호출 중 예외: " + e.getMessage());
        }
    }

}