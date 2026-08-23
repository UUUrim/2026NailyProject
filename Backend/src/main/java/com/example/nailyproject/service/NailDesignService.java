package com.example.nailyproject.service;

import com.example.nailyproject.dto.PromptResult;
import com.example.nailyproject.dto.SlotData;
import com.example.nailyproject.dto.request.DesignGenerateRequestDto;
import com.example.nailyproject.dto.response.DesignGenerateResponseDto;
import com.example.nailyproject.dto.response.DesignImageResponseDto;
import com.example.nailyproject.dto.response.DesignDetailResponseDto;
import com.example.nailyproject.dto.response.DesignLikeResponseDto;
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
import java.time.LocalDateTime;
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
    private final DesignLikeRepository designLikeRepository;
    private final FingerDesignPlanService fingerDesignPlanService;
    private final WebClient.Builder webClientBuilder;
    private final ColorNameService colorNameService;
    private final ChatMessageRepository chatMessageRepository;

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
                             DesignLikeRepository designLikeRepository,
                             FingerDesignPlanService fingerDesignPlanService,
                             WebClient.Builder webClientBuilder,
                             ColorNameService colorNameService,
                             ChatMessageRepository chatMessageRepository) {
        this.nailDesignRepository = nailDesignRepository;
        this.userRepository = userRepository;
        this.designSessionRepository = designSessionRepository;
        this.handScanRepository = handScanRepository;
        this.s3Service = s3Service;
        this.savedDesignRepository = savedDesignRepository;
        this.designLikeRepository = designLikeRepository;
        this.fingerDesignPlanService = fingerDesignPlanService;
        this.webClientBuilder = webClientBuilder;
        this.colorNameService = colorNameService;
        this.chatMessageRepository = chatMessageRepository;
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
                .details(buildDetails(nailDesign))
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
        String colorPaletteJson = null;
        for (String ngrokUrl : ngrokUrls) {
            HttpEntity<Void> imageRequest = new HttpEntity<>(getHeaders());
            ResponseEntity<byte[]> imageResponse = restTemplate.exchange(
                    ngrokUrl, HttpMethod.GET, imageRequest, byte[].class
            );
            byte[] imageBytes = imageResponse.getBody();

            String s3Key = "designs/user_" + userId + "/" + UUID.randomUUID().toString() + ".png";
            String s3Url = s3Service.uploadImageBytes(imageBytes, s3Key);

            s3Urls.add(s3Url);

            // 첫 번째 이미지(batch_size=1이라 사실상 1장뿐)를 컬러 워크플로우에 넘겨서
            // 팔레트를 뽑는다. 실패해도 디자인 생성 자체는 계속 진행되도록 조용히 넘어간다.
            if (colorPaletteJson == null) {
                try {
                    List<String> palette = extractColorPalette(imageBytes);
                    colorPaletteJson = objectMapper.writeValueAsString(palette);
                } catch (Exception e) {
                    System.err.println("컬러 팔레트 추출 실패, 결과 화면엔 색상 없이 진행: " + e.getMessage());
                }
            }
        }

        NailDesign design = NailDesign.builder()
                .user(user)
                .session(session)
                .imageUrls(s3Urls)
                .promptSummary(prompt)
                .aiModel("z-image-turbo + lora-v1")
                .status(NailDesign.DesignStatus.DRAFT)
                .colorPalette(colorPaletteJson)
                .build();

        return nailDesignRepository.save(design);
    }

    /**
     * 방금 생성된 네일 디자인 이미지를 ComfyUI 컬러 팔레트 워크플로우에 태워서
     * 대표 색상 hex 리스트를 뽑아낸다.
     * (참고: LoadImage 노드는 ComfyUI 서버 자체의 input 폴더 파일명을 참조하는 구조라서,
     *  방금 만든 이미지를 먼저 /upload/image로 그 폴더에 올려준 뒤 워크플로우를 돌린다.)
     */
    private List<String> extractColorPalette(byte[] imageBytes) throws Exception {
        String comfyFilename = uploadImageToComfy(imageBytes);

        Map<String, Object> workflow = buildColorPaletteWorkflow(comfyFilename);
        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("prompt", workflow);
        requestBody.put("client_id", UUID.randomUUID().toString());

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(requestBody, getHeaders());
        ResponseEntity<String> response = restTemplate.postForEntity(COMFY_URL + "/prompt", request, String.class);
        JsonNode responseJson = objectMapper.readTree(response.getBody());
        String promptId = responseJson.get("prompt_id").asText();

        String rawHexText = waitForColorPaletteText(promptId);

        List<String> hexes = new ArrayList<>();
        for (String token : rawHexText.split("[,\\n]")) {
            String trimmed = token.trim();
            if (trimmed.matches("^#[0-9A-Fa-f]{6}$")) {
                hexes.add(trimmed.toUpperCase());
            }
        }
        return hexes;
    }

    /** ComfyUI의 /upload/image로 이미지를 올리고, LoadImage 노드에 쓸 수 있는 파일명을 돌려받는다. */
    private String uploadImageToComfy(byte[] imageBytes) {
        String filename = "naily_palette_" + UUID.randomUUID() + ".png";

        org.springframework.util.MultiValueMap<String, Object> body = new org.springframework.util.LinkedMultiValueMap<>();
        body.add("image", new org.springframework.core.io.ByteArrayResource(imageBytes) {
            @Override
            public String getFilename() {
                return filename;
            }
        });
        body.add("type", "input");
        body.add("overwrite", "true");

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(org.springframework.http.MediaType.MULTIPART_FORM_DATA);
        headers.set("ngrok-skip-browser-warning", "true");

        HttpEntity<org.springframework.util.MultiValueMap<String, Object>> request = new HttpEntity<>(body, headers);
        ResponseEntity<String> response = restTemplate.postForEntity(COMFY_URL + "/upload/image", request, String.class);

        try {
            JsonNode uploadResult = objectMapper.readTree(response.getBody());
            // ComfyUI가 실제로 저장한 파일명을 우선 사용 (overwrite=false일 때 이름이 달라질 수 있음)
            return uploadResult.has("name") ? uploadResult.get("name").asText() : filename;
        } catch (Exception e) {
            return filename;
        }
    }

    // 컬러 팔레트 워크플로우의 ShowText 노드 id (SegmentV2 기반 — ImageCropV2보다 정밀한 배경 제거)
    private static final String COLOR_WORKFLOW_SHOWTEXT_NODE_ID = "30";

    /** 컬러_워크플로우.json 구조 그대로 재현. LoadImage(1)만 방금 업로드한 파일명으로 채운다. */
    private Map<String, Object> buildColorPaletteWorkflow(String comfyFilename) {
        Map<String, Object> workflow = new HashMap<>();

        workflow.put("1", Map.of(
                "inputs", Map.of("image", comfyFilename),
                "class_type", "LoadImage"
        ));
        workflow.put("26", Map.of(
                "inputs", Map.ofEntries(
                        Map.entry("prompt", "nail tip"),
                        Map.entry("sam_model", "sam_vit_h (2.56GB)"),
                        Map.entry("dino_model", "GroundingDINO_SwinT_OGC (694MB)"),
                        Map.entry("threshold", 0.35),
                        Map.entry("mask_blur", 0),
                        Map.entry("mask_offset", 0),
                        Map.entry("invert_output", false),
                        Map.entry("background", "Color"),
                        Map.entry("background_color", "#ffffff"),
                        Map.entry("image", new Object[]{"1", 0})
                ),
                "class_type", "SegmentV2"
        ));
        workflow.put("27", Map.of(
                "inputs", Map.of(
                        "filename_prefix", "nail",
                        "images", new Object[]{"26", 0}
                ),
                "class_type", "SaveImage"
        ));
        workflow.put("28", Map.of(
                "inputs", Map.of(
                        "colors", 8,
                        "mode", "Chart",
                        "image", new Object[]{"26", 0}
                ),
                "class_type", "Image Color Palette"
        ));
        workflow.put("29", Map.of(
                "inputs", Map.of(
                        "delimiter", ", ",
                        "text_list", new Object[]{"28", 1}
                ),
                "class_type", "Text List to Text"
        ));
        workflow.put(COLOR_WORKFLOW_SHOWTEXT_NODE_ID, Map.of(
                "inputs", Map.of(
                        "text_0", "",
                        "text", new Object[]{"29", 0}
                ),
                "class_type", "ShowText|pysssss"
        ));
        workflow.put("31", Map.of(
                "inputs", Map.of("images", new Object[]{"28", 0}),
                "class_type", "PreviewImage"
        ));

        return workflow;
    }

    /**
     * waitForImage와 같은 폴링 패턴이지만, 이미지(노드 9)가 아니라
     * ShowText 노드(COLOR_WORKFLOW_SHOWTEXT_NODE_ID)의 텍스트 출력을 기다린다.
     */
    private String waitForColorPaletteText(String promptId) throws Exception {
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
            if (!history.has(promptId)) continue;

            JsonNode outputs = history.get(promptId).get("outputs");
            if (outputs == null || !outputs.has(COLOR_WORKFLOW_SHOWTEXT_NODE_ID)) continue;

            JsonNode node5Output = outputs.get(COLOR_WORKFLOW_SHOWTEXT_NODE_ID);
            // pysssss ShowText 계열은 보통 "text" 키에 문자열 배열을 담아 돌려준다.
            // 혹시 다른 키를 쓰는 버전이면, 배열 형태인 첫 번째 필드를 폴백으로 사용한다.
            JsonNode textArray = node5Output.has("text") ? node5Output.get("text") : null;
            if (textArray == null || !textArray.isArray() || textArray.isEmpty()) {
                var fields = node5Output.fields();
                while (fields.hasNext()) {
                    var entry = fields.next();
                    if (entry.getValue().isArray() && !entry.getValue().isEmpty()) {
                        textArray = entry.getValue();
                        break;
                    }
                }
            }
            if (textArray != null && textArray.isArray() && !textArray.isEmpty()) {
                return textArray.get(0).asText();
            }
        }
        throw new RuntimeException("컬러 팔레트 추출 타임아웃");
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
     * DRAFT(생성만 하고 "이 디자인으로 할게요"를 안 누른 것)는 제외한다 — 채팅 중 나온
     * 모든 시도가 아니라, 사용자가 실제로 확정한 디자인만 이력에 남기기 위함.
     */
    public List<DesignImageResponseDto> getUserDesignHistory(Long userId) {
        List<NailDesign> designs = nailDesignRepository.findAllByUserIdOrderByGeneratedAtDesc(userId).stream()
                .filter(d -> d.getStatus() != NailDesign.DesignStatus.DRAFT)
                .toList();

        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy. M. d. HH:mm:ss");
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
                            .shared(design.isShared())
                            .build();
                    resultList.add(item);
                }
            }
        }
        return resultList;
    }

    /**
     * 채팅에서 "네, 이 디자인으로 할게요"를 눌렀을 때 호출 — 이때부터 마이페이지 이력에 노출된다.
     * POST/PATCH /designs/{designId}/confirm
     */
    public void confirmDesign(User user, Long designId) {
        NailDesign design = nailDesignRepository.findById(designId)
                .orElseThrow(() -> new IllegalArgumentException("해당 디자인을 찾을 수 없습니다."));

        if (!design.getUser().getId().equals(user.getId())) {
            throw new IllegalArgumentException("본인의 디자인만 확정할 수 있습니다.");
        }

        if (design.getStatus() == NailDesign.DesignStatus.DRAFT) {
            design.updateStatus(NailDesign.DesignStatus.CONFIRMED);
            nailDesignRepository.save(design);
        }
        // 이미 CONFIRMED 이상이면 그대로 둔다 (중복 확정 눌러도 상태가 뒤로 안 가게)
    }

    /**
     * 이 디자인이 만들어진 채팅 세션의 대화 내역을 시간순으로 조회.
     * 텍스트 대화(ChatMessage)뿐 아니라, 이 세션에서 나왔던 중간 디자인 이미지들
     * (NailDesign, 재생성 시도 포함)도 "짜잔! 이런 디자인은 어떠세요?" 형태의
     * 합성 assistant 메시지로 만들어서 같이 시간순으로 섞어 넣는다.
     * GET /designs/{designId}/chat-history
     */
    public List<com.example.nailyproject.dto.response.ChatMessageResponseDto> getDesignChatHistory(User user, Long designId) {
        NailDesign design = nailDesignRepository.findById(designId)
                .orElseThrow(() -> new IllegalArgumentException("해당 디자인을 찾을 수 없습니다."));

        if (!design.getUser().getId().equals(user.getId())) {
            throw new IllegalArgumentException("본인의 디자인만 조회할 수 있습니다.");
        }

        if (design.getSession() == null) {
            return List.of(); // 세션 없이 만들어진 디자인(레거시 등)이면 빈 목록
        }

        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
        Long sessionId = design.getSession().getId();

        record TimelineEntry(java.time.LocalDateTime time, com.example.nailyproject.dto.response.ChatMessageResponseDto dto) {}

        List<TimelineEntry> timeline = new ArrayList<>();

        for (ChatMessage m : chatMessageRepository.findBySessionOrderBySentAtAsc(design.getSession())) {
            timeline.add(new TimelineEntry(
                    m.getSentAt(),
                    com.example.nailyproject.dto.response.ChatMessageResponseDto.builder()
                            .role(m.getRole().name())
                            .content(m.getContent())
                            .sentAt(m.getSentAt() != null ? m.getSentAt().format(formatter) : "")
                            .build()
            ));
        }

        boolean referencePhotoAlreadyShown = false;
        for (NailDesign d : nailDesignRepository.findBySessionIdOrderByGeneratedAtAsc(sessionId)) {
            if (d.getImageUrls() == null || d.getImageUrls().isEmpty()) continue;
            boolean isFinalConfirmed = d.getId().equals(designId);

            // 사진 기반 생성이었다면, "이 사진으로 만들어줘" 사용자 메시지를 결과 이미지 직전에 끼워 넣는다.
            // 단, 같은 세션에서 "수정하고 싶어요"로 재생성할 때마다 같은 사진이 다시 업로드/저장되므로,
            // 세션당 딱 한 번(가장 처음 나온 것)만 보여준다 — 안 그러면 재생성 횟수만큼 이 사진
            // 메시지가 중복으로 계속 나온다.
            if (!referencePhotoAlreadyShown && d.getReferenceImageUrl() != null && !d.getReferenceImageUrl().isBlank()) {
                referencePhotoAlreadyShown = true;
                java.time.LocalDateTime referenceTime = d.getGeneratedAt() != null
                        ? d.getGeneratedAt().minusSeconds(1) : null;
                timeline.add(new TimelineEntry(
                        referenceTime,
                        com.example.nailyproject.dto.response.ChatMessageResponseDto.builder()
                                .role("user")
                                .content("이 사진으로 만들어줘")
                                .sentAt(referenceTime != null ? referenceTime.format(formatter) : "")
                                .imageUrls(List.of(d.getReferenceImageUrl()))
                                .build()
                ));
            }

            timeline.add(new TimelineEntry(
                    d.getGeneratedAt(),
                    com.example.nailyproject.dto.response.ChatMessageResponseDto.builder()
                            .role("assistant")
                            .content(isFinalConfirmed ? "짜잔! 이런 디자인은 어떠세요? (최종 확정)" : "짜잔! 이런 디자인은 어떠세요?")
                            .sentAt(d.getGeneratedAt() != null ? d.getGeneratedAt().format(formatter) : "")
                            .imageUrls(d.getImageUrls())
                            .designId(d.getId())
                            .build()
            ));
        }

        return timeline.stream()
                .sorted(Comparator.comparing(
                        e -> e.time() != null ? e.time() : java.time.LocalDateTime.MIN))
                .map(TimelineEntry::dto)
                .toList();
    }

    /**
     * '둘러보기' 커뮤니티 갤러리 GET /designs/community
     * 사용자가 공유(share)한 디자인만 반환. 좋아요 수가 많은 순으로 정렬.
     * 디자인 1건당 대표 이미지 1장(첫 번째 이미지)만 사용.
     * 좋아요(DesignLike)는 찜(SavedDesign)과 분리되어 집계된다.
     */
    public List<CommunityDesignResponseDto> getCommunityGallery(User user) {
        List<NailDesign> designs = nailDesignRepository.findTop60BySharedTrueOrderBySharedAtDesc();

        List<Long> designIds = designs.stream().map(NailDesign::getId).toList();
        Map<Long, Long> likeCountByDesignId = new HashMap<>();
        if (!designIds.isEmpty()) {
            for (Object[] row : designLikeRepository.countLikesByDesignIds(designIds)) {
                likeCountByDesignId.put((Long) row[0], (Long) row[1]);
            }
        }

        Set<Long> myLikedDesignIds = user != null
                ? new HashSet<>(designLikeRepository.findDesignIdsByUserId(user.getId()))
                : Set.of();

        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy. M. d.");
        List<CommunityDesignResponseDto> resultList = new ArrayList<>();

        for (NailDesign design : designs) {
            if (design.getImageUrls() == null || design.getImageUrls().isEmpty()) continue;

            LocalDateTime displayAt = design.getSharedAt() != null ? design.getSharedAt() : design.getGeneratedAt();
            String formattedDate = displayAt != null ? displayAt.format(formatter) : "";
            long likeCount = likeCountByDesignId.getOrDefault(design.getId(), 0L);

            resultList.add(CommunityDesignResponseDto.builder()
                    .designId(design.getId())
                    .imageUrl(design.getImageUrls().get(0))
                    .createdAt(formattedDate)
                    .likeCount(likeCount)
                    .likedByMe(myLikedDesignIds.contains(design.getId()))
                    .details(buildDetails(design))
                    .build());
        }

        resultList.sort(Comparator
                .comparingLong(CommunityDesignResponseDto::getLikeCount).reversed()
                .thenComparing(CommunityDesignResponseDto::getCreatedAt, Comparator.nullsLast(Comparator.reverseOrder())));

        return resultList;
    }

    /** 둘러보기 좋아요 POST /designs/{designId}/reactions */
    @Transactional
    public DesignLikeResponseDto addDesignLike(User user, Long designId) {
        if (user == null) {
            throw new IllegalArgumentException("로그인이 필요합니다.");
        }
        NailDesign design = nailDesignRepository.findById(designId)
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 디자인입니다."));
        if (!design.isShared()) {
            throw new IllegalArgumentException("공유된 디자인만 좋아요할 수 있습니다.");
        }
        if (!designLikeRepository.existsByUserAndNailDesign(user, design)) {
            designLikeRepository.save(DesignLike.builder()
                    .user(user)
                    .nailDesign(design)
                    .build());
        }
        return DesignLikeResponseDto.builder()
                .designId(designId)
                .likeCount(designLikeRepository.countByNailDesign(design))
                .liked(true)
                .build();
    }

    /** 둘러보기 좋아요 취소 DELETE /designs/{designId}/reactions */
    @Transactional
    public DesignLikeResponseDto removeDesignLike(User user, Long designId) {
        if (user == null) {
            throw new IllegalArgumentException("로그인이 필요합니다.");
        }
        NailDesign design = nailDesignRepository.findById(designId)
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 디자인입니다."));
        designLikeRepository.findByUserAndNailDesign(user, design)
                .ifPresent(designLikeRepository::delete);
        return DesignLikeResponseDto.builder()
                .designId(designId)
                .likeCount(designLikeRepository.countByNailDesign(design))
                .liked(false)
                .build();
    }

    /**
     * 디자인 상세 조회 GET /designs/{designId}
     * - 공유된 디자인은 누구나 조회 가능
     * - 미공유 디자인은 소유자만 조회 가능
     */
    public DesignDetailResponseDto getDesignDetail(User user, Long designId) {
        NailDesign design = nailDesignRepository.findById(designId)
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 디자인입니다."));

        boolean isOwner = user != null && design.getUser().getId().equals(user.getId());
        if (!design.isShared() && !isOwner) {
            throw new IllegalArgumentException("공유되지 않은 디자인입니다.");
        }

        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy. M. d. HH:mm");
        String formattedDate = design.getGeneratedAt() != null
                ? design.getGeneratedAt().format(formatter) : "";
        String imageUrl = (design.getImageUrls() != null && !design.getImageUrls().isEmpty())
                ? design.getImageUrls().get(0) : null;

        return DesignDetailResponseDto.builder()
                .designId(design.getId())
                .imageUrl(imageUrl)
                .imageUrls(design.getImageUrls())
                .createdAt(formattedDate)
                .shared(design.isShared())
                .owner(isOwner)
                .details(buildDetails(design))
                .build();
    }

    /** 둘러보기에 디자인 공유 POST /designs/{designId}/share */
    @Transactional
    public DesignDetailResponseDto shareDesign(User user, Long designId) {
        if (user == null) {
            throw new IllegalArgumentException("로그인이 필요합니다.");
        }
        NailDesign design = nailDesignRepository.findByIdAndUserId(designId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("본인의 디자인만 공유할 수 있습니다."));
        if (design.getImageUrls() == null || design.getImageUrls().isEmpty()) {
            throw new IllegalArgumentException("이미지가 없는 디자인은 공유할 수 없습니다.");
        }
        design.share();
        return getDesignDetail(user, designId);
    }

    /** 둘러보기 공유 해제 DELETE /designs/{designId}/share */
    @Transactional
    public DesignDetailResponseDto unshareDesign(User user, Long designId) {
        if (user == null) {
            throw new IllegalArgumentException("로그인이 필요합니다.");
        }
        NailDesign design = nailDesignRepository.findByIdAndUserId(designId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("본인의 디자인만 공유 해제할 수 있습니다."));
        design.unshare();
        return getDesignDetail(user, designId);
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
        designLikeRepository.deleteAllByNailDesign(design);

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

        // "수정하고 싶어요" 흐름이면 같은 세션에 이전 디자인이 이미 있을 것이므로, 그 플랜을
        // 이어서 편집하게 넘긴다. 첫 생성이면 이전 디자인이 없어서 null이 되고, 지금까지처럼
        // 완전히 새로 만든다.
        String previousPlanJson = null;
        if (session != null) {
            previousPlanJson = nailDesignRepository.findTopBySessionIdOrderByGeneratedAtDesc(session.getId())
                    .map(com.example.nailyproject.entity.NailDesign::getDesignPlan)
                    .filter(p -> p != null && !p.isBlank())
                    .orElse(null);
        }

        JsonNode plan = fingerDesignPlanService.generatePlan(summary, imageBase64, imageMimeType, previousPlanJson);

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

        // 사진 기반 생성이면, 사용자가 업로드한 원본 참고 이미지를 S3에 올려서 저장해둔다.
        // (이걸 안 해두면 이 요청이 끝나는 즉시 imageBase64는 버려져서, 나중에 마이페이지에서
        // "채팅 이력 보기"로 재연할 때 사용자가 올렸던 사진을 다시 보여줄 방법이 없다.)
        // 세션에 이미 저장된 참고 이미지 URL이 있으면(=이전에 한 번 업로드한 적 있으면)
        // 그대로 재사용하고, 매 재생성마다 같은 사진을 S3에 또 올리지 않는다.
        if (imageBase64 != null && !imageBase64.isBlank()) {
            String existingReferenceUrl = session != null ? session.getReferenceImageUrl() : null;
            if (existingReferenceUrl != null && !existingReferenceUrl.isBlank()) {
                nailDesign.updateReferenceImageUrl(existingReferenceUrl);
            } else {
                try {
                    byte[] referenceImageBytes = Base64.getDecoder().decode(imageBase64);
                    String extension = imageMimeType != null && imageMimeType.contains("png") ? ".png" : ".jpg";
                    String s3Key = "designs/user_" + user.getId() + "/reference_" + UUID.randomUUID() + extension;
                    String referenceImageUrl = s3Service.uploadImageBytes(referenceImageBytes, s3Key);
                    nailDesign.updateReferenceImageUrl(referenceImageUrl);
                    if (session != null) {
                        session.updateReferenceImageUrl(referenceImageUrl);
                    }
                } catch (Exception e) {
                    System.err.println("참고 이미지 S3 업로드 실패, 채팅 이력 재연에서는 빠지지만 디자인 생성 자체는 계속 진행: " + e.getMessage());
                }
            }
        }

        nailDesignRepository.save(nailDesign);

        sendPlanToPartsGenerator(user.getId(), handScan != null ? handScan.getId() : null, nailDesign.getId(), plan);

        return DesignGenerateResponseDto.builder()
                .designId(nailDesign.getId())
                .status(nailDesign.getStatus().name())
                .generatedPrompt(combinedPrompt)
                .imageUrls(nailDesign.getImageUrls())
                .details(buildDetails(nailDesign))
                .build();
    }

    /** DesignGenerateResponseDto.Details 조립 — colorPalette + designPlan에서 질감/파츠 추출 */
    private DesignGenerateResponseDto.Details buildDetails(NailDesign nailDesign) {
        List<String> colorPalette = List.of();
        if (nailDesign.getColorPalette() != null && !nailDesign.getColorPalette().isBlank()) {
            try {
                colorPalette = objectMapper.readValue(nailDesign.getColorPalette(),
                        objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));
            } catch (Exception e) {
                System.err.println("colorPalette 파싱 실패: " + nailDesign.getColorPalette());
            }
        }

        LinkedHashSet<String> textures = new LinkedHashSet<>();
        LinkedHashSet<String> nailParts = new LinkedHashSet<>();
        if (nailDesign.getDesignPlan() != null && !nailDesign.getDesignPlan().isBlank()) {
            try {
                JsonNode plan = objectMapper.readTree(nailDesign.getDesignPlan());
                addIfMeaningful(textures, plan.path("designType").asText(""));
                addIfMeaningful(nailParts, plan.path("motif").asText(""));

                JsonNode fingers = plan.path("fingers");
                if (fingers.isArray()) {
                    for (JsonNode finger : fingers) {
                        addIfMeaningful(textures, finger.path("design_type").asText(""));
                        addIfMeaningful(nailParts, finger.path("motif").asText(""));
                        JsonNode parts = finger.path("parts");
                        if (parts.isArray()) {
                            for (JsonNode part : parts) {
                                addIfMeaningful(nailParts, part.asText(""));
                            }
                        }
                    }
                }
            } catch (Exception e) {
                System.err.println("designPlan 파싱 실패: " + e.getMessage());
            }
        }

        return DesignGenerateResponseDto.Details.builder()
                .colorPalette(colorPalette)
                .textures(new ArrayList<>(textures))
                .nailParts(new ArrayList<>(nailParts))
                .build();
    }

    private void addIfMeaningful(Set<String> target, String value) {
        if (value == null) return;
        String trimmed = value.trim();
        if (trimmed.isEmpty()) return;
        if ("none".equalsIgnoreCase(trimmed) || "null".equalsIgnoreCase(trimmed)) return;
        target.add(trimmed);
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
        // color는 여기서 역채움하지 않는다 — plan.color는 "sand beige, sky blue..." 같은
        // 자유 서술 문구라서, hex를 기대하는 summarizeSlots()/colorNameService에 들어가면
        // "#sand beige" 같은 깨진 값이 만들어진다. color 슬롯은 hex를 다루는 경로
        // (ChatService/RefineService)에서만 채워지도록 비워둔다.
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
                    boolean allHex = liked.stream().allMatch(v -> v != null && v.trim().matches("^#?[0-9A-Fa-f]{6}$"));
                    List<String> resolvedNames = allHex
                            // hex -> 영어 이름 변환은 Gemini의 추측이 아니라 ColorNameService(외부 API + 로컬 폴백)로 확정
                            ? colorNameService.resolveColorNames(liked).stream().distinct().toList()
                            // hex가 아닌 값(예: 사진 기반 플랜의 서술형 컬러)은 변환 시도 없이 그대로 사용
                            : liked.stream().distinct().toList();
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

        // 사용자가 특정 글자/텍스트를 요청했는지 확인 (FingerDesignPlanService가 그 경우
        // design_type/parts를 큰따옴표로 감싸서 채워두기로 약속돼 있음). 그런 요청이 있는데도
        // "no text"를 그대로 넣으면 "글자 넣어줘"와 "글자 넣지 마"가 같은 프롬프트 안에서
        // 서로 상쇄돼버리므로, 이 경우엔 "no text"만 빼고 나머지 negative는 그대로 둔다.
        boolean hasExplicitTextRequest = parts.stream().anyMatch(p -> p.contains("\""));

        for (String fingerName : List.of("thumb", "index", "middle", "ring", "pinky")) {
            JsonNode finger = plan.get(fingerName);
            if (finger == null) continue;
            List<String> fingerDislikes = fingerDislikesMap.getOrDefault(fingerName, List.of());
            String desc = describeFingerForPrompt(fingerName, finger, fingerDislikes);
            if (desc != null) {
                parts.add(desc);
                if (desc.contains("\"")) hasExplicitTextRequest = true;
            }
        }

        // 모든 프롬프트에 기본으로 들어가는 고정 지침
        parts.add("placed with generous spacing and no overlapping, each charm must have perfectly defined sharp edges and clean precise shape");

        if (!mood.isBlank()) parts.add(toPromptText(mood) + " mood");
        if (!season.isBlank() && !"none".equalsIgnoreCase(season)) parts.add(toPromptText(season));

        if (!noPhrases.isEmpty()) {
            parts.add(String.join(", ", noPhrases));
        }

        parts.add("top-down flat lay view");
        parts.add("plain white background");
        parts.add(hasExplicitTextRequest
                ? "no shadow, no hands, no fingers, no watermark, no reflection"
                : "no shadow, no hands, no fingers, no text, no watermark, no reflection");
        parts.add("product shot");

        // 방어적 정리: 특정 글자 요청("E" 등)을 처리할 때 Gemini가 가끔 \"E\" 처럼
        // 불필요한 백슬래시를 끼워 넣는 경우가 있어서, 최종 조립 직전에 한 번 걸러낸다.
        List<String> sanitizedParts = parts.stream()
                .map(p -> p.replace("\\\"", "\""))
                .toList();

        String result = String.join(", ", sanitizedParts);
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

        String designTypeLower = designType.toLowerCase();
        if (hasParts) {
            List<String> partTags = new ArrayList<>();
            partsList.forEach(p -> {
                String tag = toPromptText(p.asText());
                // design_type 문구 안에 이미 같은 내용이 들어있으면 중복 표기하지 않는다
                // (예: 글자 요청을 Gemini가 design_type과 parts 양쪽에 다 써버리는 경우 방지).
                if (!tag.isBlank() && !designTypeLower.contains(tag.toLowerCase())) {
                    partTags.add(tag);
                }
            });
            if (!partTags.isEmpty()) {
                descriptors.add("with " + String.join(" and ", partTags));
            }
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