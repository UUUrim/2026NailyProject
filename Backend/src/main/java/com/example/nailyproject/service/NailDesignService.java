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
import com.fasterxml.jackson.databind.node.ObjectNode;
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

    // ★ 신규: ComfyUI 대체 서비스
    private final NailImageService nailImageService;
    private final NailDetectionService nailDetectionService;
    private final TextureExtractService textureExtractService;
    private final TextureSwatchService textureSwatchService;
    private final GptClientService gptClientService;
    private final FinishReferenceService finishReferenceService;
    private final ScanResultFileService scanResultFileService;
    // 색상
//    private final JsonColorMapper jsonColorMapper;


    private static final String BASE_NEGATIVE_PROMPT =
            "hands, fingers, skin, blurry, low quality, watermark, text, bad anatomy, deformed, ugly, dots, polka dot, stripes, dark colors, bold colors, tweezers, tools, props, gray background, colored background";

    private static final Map<String, String> TEXTURE_KEYWORD_MAP = new LinkedHashMap<>();
    static {
        TEXTURE_KEYWORD_MAP.put("glitter",      "glitter");
        TEXTURE_KEYWORD_MAP.put("marble",       "marble");
        TEXTURE_KEYWORD_MAP.put("magnetic",     "magnetic_chrome");
        TEXTURE_KEYWORD_MAP.put("cat eye",      "magnetic_chrome");
        TEXTURE_KEYWORD_MAP.put("mercury",      "mercury_chrome");
        TEXTURE_KEYWORD_MAP.put("powder",       "powder");
        TEXTURE_KEYWORD_MAP.put("aurora",       "powder");
        TEXTURE_KEYWORD_MAP.put("matte",        "matte");
        TEXTURE_KEYWORD_MAP.put("3d charm",     "3d_charm");
        TEXTURE_KEYWORD_MAP.put("drawing",      "drawing");
        TEXTURE_KEYWORD_MAP.put("doodle",       "drawing");
        TEXTURE_KEYWORD_MAP.put("solid color",  "plain_solid");
    }

    @org.springframework.beans.factory.annotation.Value("${analysis.server.url:http://localhost:8000}")
    private String analysisServerUrl;

    // "디자인 생성하기"가 실제 이미지를 어디서 만들지 고르는 토글. diffusers(기본, 기존 gen 서버) / comfy / gptimage.
    // application.yml의 naily.image-provider로 바꾸고 재시작하면 됨(런타임 전환 아님).
    @org.springframework.beans.factory.annotation.Value("${naily.image-provider:diffusers}")
    private String imageProvider;

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
                             ChatMessageRepository chatMessageRepository,
                             NailImageService nailImageService,
                             NailDetectionService nailDetectionService,
                             TextureExtractService textureExtractService,
                             TextureSwatchService textureSwatchService,
                             GptClientService gptClientService,
                             FinishReferenceService finishReferenceService,
                             ScanResultFileService scanResultFileService) {
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
        this.nailImageService = nailImageService;
        this.nailDetectionService = nailDetectionService;
        this.textureExtractService = textureExtractService;
        this.textureSwatchService = textureSwatchService;
        this.gptClientService = gptClientService;
        this.finishReferenceService = finishReferenceService;
        this.scanResultFileService = scanResultFileService;
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
     * sessionId, scanId 받아서 프롬프트 자동 생성 후 gen 서버 호출
     */
    public DesignGenerateResponseDto generateDesignFromSession(User user, DesignGenerateRequestDto request) throws Exception {

        DesignSession session = null;
        if (request.getSessionId() != null) {
            session = designSessionRepository.findByIdAndUserId(request.getSessionId(), user.getId())
                    .orElseThrow(() -> new IllegalArgumentException("해당 채팅 세션을 찾을 수 없습니다."));
        }

        HandScan handScan = handScanRepository.findByIdAndUserId(request.getScanId(), user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 스캔을 찾을 수 없습니다."));

        PromptResult promptResult = buildFinalPrompt(session, handScan);

        if (session != null) {
            session.updateGeneratedPrompt(promptResult.prompt());
        }

        NailDesign nailDesign = generateDesign(user.getId(), promptResult.prompt(), promptResult.negativePrompt(), session);

        return DesignGenerateResponseDto.builder()
                .designId(nailDesign.getId())
                .status(nailDesign.getStatus().name())
                .generatedPrompt(promptResult.prompt())
                .imageUrls(nailDesign.getImageUrls())
                .details(buildDetails(nailDesign))
                .build();
    }

    /** 하위 호환용 (세션 없이) */
    public NailDesign generateDesign(Long userId, String prompt, String negativePrompt) throws Exception {
        return generateDesign(userId, prompt, negativePrompt, null);
    }

    // ComfyUI 브릿지 서버(main_comfy.py)에 고정으로 박혀있는 seed — 요청으로 안 받고 항상
    // 이 값으로 생성되므로(재현성 확인됨), 여기서도 실제 사용된 값 그대로 기록만 해 둔다.
    private static final long COMFY_FIXED_SEED = 258936135452521L;

    /**
     * naily.image-provider 설정값에 따라 실제 이미지를 만드는 곳이 갈린다.
     * - (기본) diffusers gen 서버 / comfy: ComfyUI 브릿지 서버(main_comfy.py) / gptimage: GPT Image 2.5 Sunburst
     * - S3 업로드
     * - nailDetectionService.extractColorsPerNail() 로 컬러 팔레트 추출
     */
    public NailDesign generateDesign(Long userId, String prompt, String negativePrompt, DesignSession session) throws Exception {
        return generateDesign(userId, prompt, negativePrompt, session, List.of());
    }

    /**
     * @param referenceFinishes 마감 질감 레퍼런스를 첨부할 마감 이름들(예: "powder finish").
     *                          gptimage provider에서만 쓰이고, 레퍼런스 호출이 실패하면 텍스트만으로 재시도한다.
     */
    public NailDesign generateDesign(Long userId, String prompt, String negativePrompt, DesignSession session,
                                     List<String> referenceFinishes) throws Exception {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found: " + userId));

        // 1. 설정된 provider로 이미지 생성 (base64 반환)
        String imageBase64;
        String aiModel;
        Long seed;
        if ("gptimage".equalsIgnoreCase(imageProvider)) {
            List<byte[]> references = finishReferenceService.referencesFor(referenceFinishes);
            if (references.isEmpty()) {
                imageBase64 = gptClientService.generateImage(prompt, "1536x1024", "auto");
            } else {
                try {
                    imageBase64 = gptClientService.generateImageWithReferences(prompt, "1536x1024", "auto", references);
                } catch (Exception e) {
                    System.err.println("[NailDesignService] 레퍼런스 첨부 생성 실패, 텍스트만으로 재시도: " + e.getMessage());
                    imageBase64 = gptClientService.generateImage(prompt, "1536x1024", "auto");
                }
            }
            aiModel = "gpt-image-2.5-sunburst";
            seed = null; // OpenAI 이미지 생성 API는 seed 개념이 없음(재현 불가)
        } else if ("comfy".equalsIgnoreCase(imageProvider)) {
            // seed는 ComfyUI 브릿지 서버에 고정값으로 박혀있어 요청으로 보내지 않는다.
            imageBase64 = nailImageService.generateNailImageViaComfy(prompt);
            aiModel = "comfyui (main_comfy.py bridge)";
            seed = COMFY_FIXED_SEED;
        } else {
            // 기본(diffusers): 기존 main과 동일하게 gen 서버(Z-Image-Turbo + LoRA)로 생성
            long diffusersSeed = (long) (Math.random() * Long.MAX_VALUE);
            imageBase64 = nailImageService.generateNailImage(prompt, diffusersSeed);
            aiModel = "z-image-turbo + lora-v1 (diffusers)";
            seed = diffusersSeed;
        }

        // 2. base64 → bytes → S3 업로드
        byte[] imageBytes = Base64.getDecoder().decode(imageBase64);
        String s3Key = "designs/user_" + userId + "/" + UUID.randomUUID() + ".png";
        String s3Url = s3Service.uploadImageBytes(imageBytes, s3Key);


        // 4. detect 서버에서 손가락별 네일팁 매트 이미지 추출 → S3 업로드 후 URL 리스트 JSON
        //    (AR 미리보기가 로컬 세그멘테이션 대신 이걸 우선 사용 - nailDesignAsset.ts 참고)
        String nailTipCropsJson = fetchAndUploadNailTipCrops(userId, imageBase64);

        NailDesign design = NailDesign.builder()
                .user(user)
                .session(session)
                .imageUrls(new ArrayList<>(List.of(s3Url)))
                .promptSummary(prompt)
                .aiModel(aiModel)
                .status(NailDesign.DesignStatus.DRAFT)
                .nailTipCropsJson(nailTipCropsJson)
                .seed(seed)
                .build();

        NailDesign saved = nailDesignRepository.save(design);
        System.out.println("[NailDesignService] designId=" + saved.getId() + " provider=" + imageProvider + " seed=" + seed);
        return saved;
    }

    private String fetchAndUploadNailTipCrops(Long userId, String imageBase64) {
        try {
            Map<String, List<String>> parts = nailDetectionService.detectParts(imageBase64, List.of("nail tip"));
            List<String> crops = parts.get("nail tip");
            System.out.println("[NailTipCrops] 탐지된 크롭 수: " + (crops != null ? crops.size() : "null")); // ★
            if (crops == null || crops.isEmpty()) return null;

            List<String> urls = new ArrayList<>();
            for (int i = 0; i < crops.size(); i++) {
                urls.add(uploadNailTipCrop(userId, crops.get(i), i));
            }
            return objectMapper.writeValueAsString(urls);
        } catch (Exception e) {
            System.err.println("네일팁 크롭 추출 실패, AR 미리보기는 기존 세그멘테이션으로 폴백: " + e.getMessage());
            return null;
        }
    }

    // detect 서버의 /parts 응답 값이 이미 호스팅된 URL인지 raw base64인지 확정된 문서가 없어
    // 둘 다 받아준다: URL이면 그대로 쓰고, 아니면 우리 S3에 업로드해서 우리 도메인 URL로 정규화한다
    // (S3Service.uploadImageBytes()가 이미 그 패턴 - 원본 디자인 이미지도 이렇게 저장한다).
    private String uploadNailTipCrop(Long userId, String crop, int index) {
        if (crop.startsWith("http://") || crop.startsWith("https://")) {
            return crop;
        }
        String base64 = crop.contains(",") ? crop.substring(crop.indexOf(',') + 1) : crop;
        byte[] bytes = Base64.getDecoder().decode(base64);
        String s3Key = "designs/user_" + userId + "/nail-tips/" + UUID.randomUUID() + "_" + index + ".png";
        return s3Service.uploadImageBytes(bytes, s3Key);
    }

    //단어 사이 하이픈 제거용
    // toPromptText - 언더스코어 추가
    private String toPromptText(String value) {
        return value.replace("-", " ").replace("_", " ");
    }

    /**
     * 슬롯(SlotData) 기반 최종 프롬프트 조립
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
        } else if (scanRecommendedShape(handScan) != null) {
            finalShape = scanRecommendedShape(handScan);
        } else {
            finalShape = "round";
        }

        List<String> finalDesigns = getLiked(slots, "designType");
        List<String> finalColors  = getLiked(slots, "color");
        if (finalColors.isEmpty()) {
            List<String> scanColors = scanRecommendedColors(handScan);
            if (!scanColors.isEmpty()) finalColors = scanColors;
        }

        List<String> finalMotifs = getLiked(slots, "motif");
        List<String> finalMoods  = getLiked(slots, "mood");

        List<String> seasonLiked = getLiked(slots, "season");
        List<String> finalSeasons = seasonLiked.stream()
                .filter(s -> !"none".equalsIgnoreCase(s))
                .limit(2)
                .toList();

        List<String> promptParts = new ArrayList<>();
        promptParts.add("nailart");
        promptParts.add(finalShape + " nail tips");

        if (!finalDesigns.isEmpty()) {
            promptParts.add(finalDesigns.stream().map(this::toPromptText).collect(Collectors.joining(" ")) + " nail art");
        }
        if (!finalColors.isEmpty()) {
            promptParts.add(finalColors.stream().limit(2).map(this::toPromptText).collect(Collectors.joining(", ")));
        }
        if (!finalMotifs.isEmpty()) {
            promptParts.add(finalMotifs.stream().map(this::toPromptText).collect(Collectors.joining(" ")) + " nail art");
        }
        if (!finalMoods.isEmpty()) {
            promptParts.add(finalMoods.stream().map(this::toPromptText).collect(Collectors.joining(" ")) + " mood");
        }
        if (!finalSeasons.isEmpty()) {
            promptParts.add(finalSeasons.stream().map(this::toPromptText).collect(Collectors.joining(", ")) + " theme");
        }

        promptParts.add("korean nail art style, product shot, white background, no hands, isolated nail tips, floating nails, disembodied nails");

        String finalPromptString = String.join(", ", promptParts);

        List<String> allDisliked = new ArrayList<>();
        for (SlotData s : slots.values()) {
            if (s.getDisliked() != null) allDisliked.addAll(s.getDisliked());
        }

        String finalNegative = allDisliked.isEmpty()
                ? BASE_NEGATIVE_PROMPT
                : BASE_NEGATIVE_PROMPT + ", " + String.join(", ", allDisliked);

        System.out.println("최종 완성 프롬프트: " + finalPromptString);
        System.out.println("최종 negative 프롬프트: " + finalNegative);

        return new PromptResult(finalPromptString, finalNegative);
    }

    private List<String> getLiked(Map<String, SlotData> slots, String category) {
        SlotData s = slots.get(category);
        return (s != null && s.getLiked() != null) ? s.getLiked() : new ArrayList<>();
    }

    /**
     * '내 디자인' 전체 이미지 목록 조회
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
                    resultList.add(DesignImageResponseDto.builder()
                            .designId(design.getId())
                            .sessionId(sessionId)
                            .imageUrl(url)
                            .promptSummary(design.getPromptSummary())
                            .createdAt(formattedDate)
                            .shared(design.isShared())
                            .build());
                }
            }
        }
        return resultList;
    }

    /**
     * 채팅에서 "네, 이 디자인으로 할게요"를 눌렀을 때 호출
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

        // ★ 컬러 추출 — 동기 (확정 응답 전에 완료되어야 프론트에서 바로 보임)
        try {
            byte[] imgBytes = s3Service.downloadImageBytes(design.getImageUrls().get(0));
            String imgBase64 = Base64.getEncoder().encodeToString(imgBytes);
            List<Map<String, Object>> perNailColors = nailDetectionService.extractColorsPerNail(imgBase64);
            List<String> palette = nailDetectionService.flattenToColorPalette(perNailColors);
            design.updateColorPalette(objectMapper.writeValueAsString(palette));
            nailDesignRepository.save(design);
            System.out.println("[Color] 팔레트 저장 완료 designId=" + designId);
        } catch (Exception e) {
            System.err.println("[Color] 컬러 추출 실패: " + e.getMessage());
        }

        // 확정 시 스와치 + 파츠 생성 (이미 있으면 건너뜀) — 비동기
        if (design.getSwatchesJson() == null || design.getSwatchesJson().isBlank()) {
            final Long finalDesignId = designId;
            final Long finalUserId = user.getId();
            final String finalPrompt = buildFullPromptForSwatch(design);

            new Thread(() -> {
                try {
                    byte[] imgBytes = s3Service.downloadImageBytes(design.getImageUrls().get(0));
                    String imgBase64 = Base64.getEncoder().encodeToString(imgBytes);

//                    // 컬러 추출
//                    try {
//                        List<Map<String, Object>> perNailColors = nailDetectionService.extractColorsPerNail(imgBase64);
//                        List<String> palette = nailDetectionService.flattenToColorPalette(perNailColors);
//                        String colorPaletteJson = objectMapper.writeValueAsString(palette);
//                        nailDesignRepository.findById(finalDesignId).ifPresent(d -> {
//                            d.updateColorPalette(colorPaletteJson);
//                            nailDesignRepository.save(d);
//                            System.out.println("[Color] 팔레트 저장 완료 designId=" + finalDesignId);
//                        });
//                    } catch (Exception e) {
//                        System.err.println("[Color] 컬러 추출 실패: " + e.getMessage());
//                    }
                    // 스와치 생성
                    List<Map<String, Object>> texturePairs =
                            textureExtractService.extractTextureColorPairs(finalPrompt);
                    if (texturePairs.isEmpty()) return;

                    Map<String, String> swatchBase64Map =
                            textureSwatchService.generateSwatches(texturePairs);

                    Map<String, String> swatchUrlMap = new LinkedHashMap<>();
                    for (Map.Entry<String, String> entry : swatchBase64Map.entrySet()) {
                        if (entry.getValue() == null || entry.getValue().isBlank()) continue;

                        // ★ mercury_chrome은 이미 S3 URL — base64 디코딩 없이 바로 저장
                        if ("mercury_chrome".equals(entry.getKey())) {
                            swatchUrlMap.put("mercury_chrome", entry.getValue());
                            continue;
                        }
                        try {
                            byte[] swatchBytes = Base64.getDecoder().decode(entry.getValue());
                            String swatchKey = "designs/user_" + finalUserId
                                    + "/swatch_" + entry.getKey() + "_" + finalDesignId + ".png";
                            String swatchUrl = s3Service.uploadImageBytes(swatchBytes, swatchKey);
                            swatchUrlMap.put(entry.getKey(), swatchUrl);
                        } catch (Exception e) {
                            System.err.println("[Swatch] " + entry.getKey() + " S3 업로드 실패: " + e.getMessage());
                        }
                    }

                    if (!swatchUrlMap.isEmpty()) {
                        nailDesignRepository.findById(finalDesignId).ifPresent(d -> {
                            try {
                                d.updateSwatchesJson(objectMapper.writeValueAsString(swatchUrlMap));
                                nailDesignRepository.save(d);
                                System.out.println("[Swatch] " + swatchUrlMap.size() + "개 스와치 저장 완료: " + swatchUrlMap.keySet());
                            } catch (Exception e) {
                                System.err.println("[Swatch] DB 저장 실패: " + e.getMessage());
                            }
                        });
                    }
                } catch (Exception e) {
                    System.err.println("[Swatch] 스와치 생성 실패: " + e.getMessage());
                }
            }, "swatch-confirm-" + finalDesignId).start();
        }
    }

    /**
     * 채팅 이력 조회 GET /designs/{designId}/chat-history
     */
    public List<com.example.nailyproject.dto.response.ChatMessageResponseDto> getDesignChatHistory(User user, Long designId) {
        NailDesign design = nailDesignRepository.findById(designId)
                .orElseThrow(() -> new IllegalArgumentException("해당 디자인을 찾을 수 없습니다."));

        if (!design.getUser().getId().equals(user.getId())) {
            throw new IllegalArgumentException("본인의 디자인만 조회할 수 있습니다.");
        }

        if (design.getSession() == null) return List.of();

        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
        Long sessionId = design.getSession().getId();

        // ★ "디자인 재생성하기"로 같은 세션을 이어서 쓰면, 이 디자인 이후에 이어서 만든 대화/디자인도
        // 같은 세션에 쌓인다. 그대로 다 보여주면 원본 디자인 이력에 나중에 이어서 수정한 내용까지
        // 섞여 보이므로, 이 디자인이 생성된 시점(generatedAt) 이후의 항목은 잘라낸다.
        java.time.LocalDateTime cutoff = design.getGeneratedAt();

        record TimelineEntry(java.time.LocalDateTime time, int order, com.example.nailyproject.dto.response.ChatMessageResponseDto dto) {}
        List<TimelineEntry> timeline = new ArrayList<>();

        for (ChatMessage m : chatMessageRepository.findBySessionOrderBySentAtAsc(design.getSession())) {
            if (cutoff != null && m.getSentAt() != null && m.getSentAt().isAfter(cutoff)) continue;
            timeline.add(new TimelineEntry(
                    m.getSentAt(),
                    0,
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
            if (cutoff != null && d.getGeneratedAt() != null && d.getGeneratedAt().isAfter(cutoff)) continue;
            boolean isFinalConfirmed = d.getId().equals(designId);

            if (!referencePhotoAlreadyShown && d.getReferenceImageUrl() != null && !d.getReferenceImageUrl().isBlank()) {
                referencePhotoAlreadyShown = true;
                java.time.LocalDateTime referenceTime = d.getGeneratedAt() != null
                        ? d.getGeneratedAt().minusSeconds(1) : null;
                timeline.add(new TimelineEntry(
                        referenceTime,
                        0,
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
                    1,
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
                .sorted(Comparator.comparing((TimelineEntry e) -> e.time() != null ? e.time() : java.time.LocalDateTime.MIN)
                        .thenComparingInt(TimelineEntry::order))
                .map(TimelineEntry::dto)
                .toList();
    }

    /**
     * 커뮤니티 갤러리 GET /designs/community
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

    @Transactional
    public DesignLikeResponseDto addDesignLike(User user, Long designId) {
        if (user == null) throw new IllegalArgumentException("로그인이 필요합니다.");
        NailDesign design = nailDesignRepository.findById(designId)
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 디자인입니다."));
        if (!design.isShared()) throw new IllegalArgumentException("공유된 디자인만 좋아요할 수 있습니다.");
        if (!designLikeRepository.existsByUserAndNailDesign(user, design)) {
            designLikeRepository.save(DesignLike.builder().user(user).nailDesign(design).build());
        }
        return DesignLikeResponseDto.builder()
                .designId(designId)
                .likeCount(designLikeRepository.countByNailDesign(design))
                .liked(true).build();
    }

    @Transactional
    public DesignLikeResponseDto removeDesignLike(User user, Long designId) {
        if (user == null) throw new IllegalArgumentException("로그인이 필요합니다.");
        NailDesign design = nailDesignRepository.findById(designId)
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 디자인입니다."));
        designLikeRepository.findByUserAndNailDesign(user, design)
                .ifPresent(designLikeRepository::delete);
        return DesignLikeResponseDto.builder()
                .designId(designId)
                .likeCount(designLikeRepository.countByNailDesign(design))
                .liked(false).build();
    }

    public DesignDetailResponseDto getDesignDetail(User user, Long designId) {
        NailDesign design = nailDesignRepository.findById(designId)
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 디자인입니다."));

        boolean isOwner = user != null && design.getUser().getId().equals(user.getId());
        if (!design.isShared() && !isOwner) throw new IllegalArgumentException("공유되지 않은 디자인입니다.");

        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy. M. d. HH:mm");
        String formattedDate = design.getGeneratedAt() != null ? design.getGeneratedAt().format(formatter) : "";
        String imageUrl = (design.getImageUrls() != null && !design.getImageUrls().isEmpty())
                ? design.getImageUrls().get(0) : null;

        return DesignDetailResponseDto.builder()
                .designId(design.getId())
                .sessionId(design.getSession() != null ? design.getSession().getId() : null)
                .imageUrl(imageUrl)
                .imageUrls(design.getImageUrls())
                .createdAt(formattedDate)
                .shared(design.isShared())
                .owner(isOwner)
                .details(buildDetails(design))
                .shape(extractShape(design))
                .nailTipCropUrls(extractNailTipCropUrls(design))
                .build();
    }

    /**
     * generateDesign()이 저장해 둔 손가락별 네일팁 매트 이미지 URL JSON 배열을 파싱한다.
     * 없거나(옛날 디자인) 추출이 실패했던 디자인이면 null - AR 미리보기가 로컬 세그멘테이션으로
     * 폴백한다.
     */
    private List<String> extractNailTipCropUrls(NailDesign design) {
        if (design.getNailTipCropsJson() == null || design.getNailTipCropsJson().isBlank()) return null;
        try {
            return objectMapper.readValue(
                    design.getNailTipCropsJson(),
                    objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * designPlan JSON에 저장된 원본 shape 키워드(round/oval/almond/square/stiletto/
     * ballerina)를 뽑아낸다. buildCombinedPromptFromPlan()이 프롬프트용으로
     * toPromptText()를 거치기 전 원본 값이라 AR 미리보기의 3D 템플릿 파일명과 그대로 매칭된다.
     */
    private String extractShape(NailDesign design) {
        if (design.getDesignPlan() == null || design.getDesignPlan().isBlank()) return null;
        try {
            JsonNode plan = objectMapper.readTree(design.getDesignPlan());
            String shape = plan.path("shape").asText(null);
            if (shape == null || shape.isBlank()) return null;
            // Gemini가 이 모양을 영어 업계 용어인 "coffin"으로 적어둘 때가 있는데, 앱
            // 내부에서는 같은 모양을 항상 "ballerina"로 통일해서 쓴다(3D 쉐입 템플릿 파일명,
            // 선택지 목록 등 전부 ballerina 기준). 그대로 두면 isKnownNailShape()에 안 걸려서
            // AR 미리보기가 3D 대신 2D 합성으로 조용히 폴백해버린다.
            if ("coffin".equalsIgnoreCase(shape.trim())) return "ballerina";
            return shape;
        } catch (Exception e) {
            return null;
        }
    }

    @Transactional
    public DesignDetailResponseDto shareDesign(User user, Long designId) {
        if (user == null) throw new IllegalArgumentException("로그인이 필요합니다.");
        NailDesign design = nailDesignRepository.findByIdAndUserId(designId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("본인의 디자인만 공유할 수 있습니다."));
        if (design.getImageUrls() == null || design.getImageUrls().isEmpty())
            throw new IllegalArgumentException("이미지가 없는 디자인은 공유할 수 없습니다.");
        design.share();
        return getDesignDetail(user, designId);
    }

    @Transactional
    public DesignDetailResponseDto unshareDesign(User user, Long designId) {
        if (user == null) throw new IllegalArgumentException("로그인이 필요합니다.");
        NailDesign design = nailDesignRepository.findByIdAndUserId(designId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("본인의 디자인만 공유 해제할 수 있습니다."));
        design.unshare();
        return getDesignDetail(user, designId);
    }

    @Transactional
    public void deleteDesign(User user, Long designId) {
        NailDesign design = nailDesignRepository.findById(designId)
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 디자인입니다."));
        if (!design.getUser().getId().equals(user.getId()))
            throw new IllegalArgumentException("본인의 디자인만 삭제할 수 있습니다.");

        savedDesignRepository.deleteAllByNailDesign(design);
        designLikeRepository.deleteAllByNailDesign(design);
        if (design.getImageUrls() != null) {
            for (String imageUrl : design.getImageUrls()) s3Service.deleteFile(imageUrl);
        }
        nailDesignRepository.delete(design);
    }


    public Map<String, String> getSwatches(Long designId) {
        NailDesign design = nailDesignRepository.findById(designId)
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 디자인입니다."));
        if (design.getSwatchesJson() == null || design.getSwatchesJson().isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(design.getSwatchesJson(),
                    objectMapper.getTypeFactory().constructMapType(
                            LinkedHashMap.class, String.class, String.class));
        } catch (Exception e) {
            return null;
        }
    }

    public DesignGenerateResponseDto generateDetailedDesign(User user, DesignGenerateRequestDto request) throws Exception {
        return generateDetailedDesignInternal(user, request, null, null);
    }

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
                    System.err.println("extractedPreferences 파싱 실패, 빈 슬롯으로 진행: " + session.getExtractedPreferences());
                    slots = new HashMap<>();
                }
            }
        }

        HandScan handScan = null;
        if (request.getScanId() != null) {
            handScan = handScanRepository.findByIdAndUserId(request.getScanId(), user.getId()).orElse(null);
        }

        // 스캔 정보 기반 자동 생성: 사용자가 취향을 하나도 입력하지 않았고, 오직 채팅 "?" 패널에
        // 표시되는 스캔 분석 결과(추천 쉐입 + 추천 컬러 팔레트)만 근거로 삼는 흐름.
        boolean scanAuto = request.getMode() != null
                && request.getMode().equalsIgnoreCase("scan-auto")
                && handScan != null;

        // scan-auto가 아니면 기존대로 빈 슬롯을 스캔 값으로 메운다.
        // (scan-auto는 아래 buildScanAutoConfirmedSummary로 팔레트 전체를 넘기므로,
        //  여기서 랜덤 단색 하나를 슬롯에 박아넣으면 원컬러 디자인으로 굳어져 버린다.)
        if (!scanAuto) {
            fillMissingFromScan(slots, handScan);
        }

        if (session != null && !scanAuto) {
            session.updateExtractedPreferences(objectMapper.writeValueAsString(slots));
        }

        String summary = scanAuto
                ? buildScanAutoConfirmedSummary(handScan)
                : summarizeSlots(slots, handScan)
                        + buildFingerInstructionText(session != null ? session.getFingerOverrides() : null)
                        + buildFingerDislikeInstructionText(session != null ? session.getFingerDislikes() : null)
                        + buildUserOwnWordsText(session);

        String previousPlanJson = null;
        if (session != null) {
            previousPlanJson = nailDesignRepository.findTopBySessionIdOrderByGeneratedAtDesc(session.getId())
                    .map(com.example.nailyproject.entity.NailDesign::getDesignPlan)
                    .filter(p -> p != null && !p.isBlank())
                    .orElse(null);
        }

        List<String> seasonLikedForTrend = getLiked(slots, "season");
        String userSeasonForTrend = seasonLikedForTrend.stream()
                .filter(s -> !"none".equals(s))
                .findFirst().orElse(null);
        // ★ motif: none 강제 금지 규칙(FingerDesignPlanService)은 사진 기반(참고 이미지가
        // 있는) 생성에서만 뺀다 — 이미지에서 관찰되는 장식은 계속 반영돼야 하기 때문.
        // ★ 손 스캔 기록 유무(handScan)는 이 판단과 무관하다 — 예전엔 handScan != null이면
        // 무조건 이 규칙을 껐었는데, 스캔을 완료해둔 계정이 "옵션 선택" 흐름으로 직접
        // motif "없음"을 골라도 그 선택이 무시되는 버그가 있었다(사용자가 직접 재현/확인함).
        // scanId가 프론트에서 매 요청마다 자동으로 함께 오는 경우가 있어서, handScan 존재
        // 여부만으로는 "이번 생성이 스캔 기반 흐름인지"를 판단할 수 없다.
        boolean hasImage = imageBase64 != null && !imageBase64.isBlank();
        JsonNode plan = fingerDesignPlanService.generatePlan(
                summary, imageBase64, imageMimeType, previousPlanJson, userSeasonForTrend, scanAuto);

        // scan-auto: 쉐입은 "?" 패널에 표시된 스캔 분석 추천 쉐입으로 강제 고정한다.
        // 플랜 생성 LLM이 다른 쉐입을 넣더라도 덮어써서, 최종 프롬프트 / AR 3D 템플릿 /
        // 저장되는 designPlan 이 모두 패널 값과 정확히 일치하도록 한다.
        if (scanAuto && plan != null && plan.isObject() && scanRecommendedShape(handScan) != null) {
            ((ObjectNode) plan).put("shape", scanRecommendedShape(handScan));
        }

        // ★ 시스템 프롬프트 지시(MOTIF_NONE_RESTRICTION)만으로는 GPT가 여전히 pearl
        // bead/rhinestone 등을 채워 넣는 경우가 실제로 재현됐다 — 프롬프트 지시는
        // 강제가 아니라 "권장"에 가깝기 때문. 옵션 선택으로 motif "없음"/"none"을
        // 명시적으로 고른 경우(사진 기반 제외)엔 Java 쪽에서 plan을 직접 후처리해서
        // motif/parts를 무조건 비워버린다. GPT가 저장한 값이 정확히 "none"이 아니라
        // "핵심 요소 없음"처럼 부가 설명이 붙었을 수도 있어서 contains로 느슨하게 검사한다.
        // ★ anyMatch면 "없음"을 고른 뒤 자유입력으로 큐빅 등을 추가해 motif 슬롯에 "none"과 실제 값이
        // 같이 남았을 때 사용자가 요청한 장식까지 전부 지워졌다 — 모든 값이 "없음"일 때만 금지로 본다.
        List<String> motifLiked = getLiked(slots, "motif");
        boolean motifExplicitlyDeclined = !hasImage && !motifLiked.isEmpty() && motifLiked.stream()
                .allMatch(v -> v != null && (v.trim().toLowerCase().contains("none") || v.contains("없음")));
        stripMotifPartsIfExplicitlyDeclined(plan, motifExplicitlyDeclined);

        if (session != null) {
            backfillSlotsFromPlan(slots, plan);
            session.updateExtractedPreferences(objectMapper.writeValueAsString(slots));
        }

        List<String> noPhrases = new ArrayList<>();
        for (Map.Entry<String, SlotData> entry : slots.entrySet()) {
            String category = entry.getKey();
            List<String> disliked = entry.getValue().getDisliked();
            if (disliked == null || disliked.isEmpty()) continue;
            if ("color".equals(category)) {
                colorNameService.resolveColorNames(disliked).forEach(name -> noPhrases.add("no " + name));
            } else {
                disliked.forEach(d -> noPhrases.add("no " + toPromptText(d)));
            }
        }

        String finalNegative = BASE_NEGATIVE_PROMPT;

        Map<String, List<String>> fingerDislikesMap = new HashMap<>();
        if (session != null && session.getFingerDislikes() != null && !session.getFingerDislikes().isBlank()) {
            try {
                JsonNode dislikesNode = objectMapper.readTree(session.getFingerDislikes());
                dislikesNode.fields().forEachRemaining(entry -> {
                    List<String> items = new ArrayList<>();
                    entry.getValue().forEach(v -> items.add(v.asText()));
                    fingerDislikesMap.put(entry.getKey(), items);
                });
            } catch (Exception ignored) {}
        }

        // ★ 마감 질감 레퍼런스(예: 파우더)는 gptimage provider일 때만, 그리고 플랜에 해당 마감이 있을 때만 쓴다.
        List<String> referenceFinishes = "gptimage".equalsIgnoreCase(imageProvider)
                ? finishReferenceService.availableFinishes(collectReferenceKeys(plan))
                : List.of();

        String combinedPrompt = buildCombinedPromptFromPlan(plan, noPhrases, fingerDislikesMap, referenceFinishes);

        if (session != null) {
            session.updateGeneratedPrompt(combinedPrompt);
        }

        // ★ gen 서버로 이미지 생성 (ComfyUI 대체)
        NailDesign nailDesign = generateDesign(user.getId(), combinedPrompt, finalNegative, session, referenceFinishes);

        nailDesign.updateDesignPlan(plan.toString());

        // 참고 이미지 S3 저장 (사진 기반 생성 시)
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
                    if (session != null) session.updateReferenceImageUrl(referenceImageUrl);
                } catch (Exception e) {
                    System.err.println("참고 이미지 S3 업로드 실패, 디자인 생성은 계속 진행: " + e.getMessage());
                }
            }
        }

        nailDesignRepository.save(nailDesign);

        // ★ 텍스처 스와치 생성 — 별도 스레드에서 비동기 실행 (메인 응답 속도에 영향 없음)
        final String finalCombinedPrompt = combinedPrompt;
        final Long finalDesignId = nailDesign.getId();
        final Long finalUserId = user.getId();


        return DesignGenerateResponseDto.builder()
                .designId(nailDesign.getId())
                .status(nailDesign.getStatus().name())
                .generatedPrompt(combinedPrompt)
                .imageUrls(nailDesign.getImageUrls())
                .details(buildDetails(nailDesign))
                .keywords(extractKeywordsFromSlots(slots, session)) //디자인결과화면 선택옵션 단어
                .scanAutoReflection(scanAuto ? buildScanAutoReflection(handScan, plan) : null)
                .build();
    }

    /**
     * ★ buildDetails: colorPalette + designPlan 파싱 + swatchesJson 포함
     */
    public DesignGenerateResponseDto.Details buildDetails(NailDesign nailDesign) {
        // colorPalette 파싱 (기존 유지)
        List<String> colorPalette = new ArrayList<>();
        if (nailDesign.getColorPalette() != null && !nailDesign.getColorPalette().isBlank()) {
            try {
                colorPalette = objectMapper.readValue(nailDesign.getColorPalette(),
                        objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));
            } catch (Exception e) {
                System.err.println("colorPalette 파싱 실패: " + nailDesign.getColorPalette());
            }
        }

        // swatchesJson 파싱 (기존 유지)
        Map<String, String> swatchMap = new LinkedHashMap<>();
        if (nailDesign.getSwatchesJson() != null && !nailDesign.getSwatchesJson().isBlank()) {
            try {
                JsonNode swatchNode = objectMapper.readTree(nailDesign.getSwatchesJson());
                swatchNode.fields().forEachRemaining(e -> swatchMap.put(e.getKey(), e.getValue().asText()));
            } catch (Exception e) {
                System.err.println("swatchesJson 파싱 실패: " + e.getMessage());
            }
        }

        // ★ textures: confirm 후엔 swatchMap 키 사용, 그 전엔 프롬프트 키워드 폴백
        String fullPrompt = buildFullPromptForSwatch(nailDesign);
        LinkedHashSet<String> textures = !swatchMap.isEmpty()
                ? new LinkedHashSet<>(swatchMap.keySet())
                : extractTexturesFromPrompt(fullPrompt);

        return DesignGenerateResponseDto.Details.builder()
                .colorPalette(colorPalette)
                .textures(new ArrayList<>(textures))
                .swatches(swatchMap.isEmpty() ? null : swatchMap)
                .build();
    }
//    public DesignGenerateResponseDto.Details buildDetails(NailDesign nailDesign) {
//        // colorPalette 파싱
//        List<String> colorPalette = new ArrayList<>();
//        if (nailDesign.getColorPalette() != null && !nailDesign.getColorPalette().isBlank()) {
//            try {
//                colorPalette = objectMapper.readValue(nailDesign.getColorPalette(),
//                        objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));
//            } catch (Exception e) {
//                System.err.println("colorPalette 파싱 실패: " + nailDesign.getColorPalette());
//            }
//        }
//
//        // designPlan에서 textures, nailParts 추출
//        LinkedHashSet<String> textures  = new LinkedHashSet<>();
//        LinkedHashSet<String> nailParts = new LinkedHashSet<>();
//        if (nailDesign.getDesignPlan() != null && !nailDesign.getDesignPlan().isBlank()) {
//            try {
//                JsonNode plan = objectMapper.readTree(nailDesign.getDesignPlan());
//                addIfMeaningful(textures, plan.path("designType").asText(""));
//                addIfMeaningful(nailParts, plan.path("motif").asText(""));
//
//                JsonNode fingers = plan.path("fingers");
//                if (fingers.isArray()) {
//                    for (JsonNode finger : fingers) {
//                        addIfMeaningful(textures, finger.path("design_type").asText(""));
//                        addIfMeaningful(nailParts, finger.path("motif").asText(""));
//                        JsonNode parts = finger.path("parts");
//                        if (parts.isArray()) {
//                            for (JsonNode part : parts) addIfMeaningful(nailParts, part.asText(""));
//                        }
//                    }
//                }
//            } catch (Exception e) {
//                System.err.println("designPlan 파싱 실패: " + e.getMessage());
//            }
//        }
//
//        // ★ swatchesJson 파싱: { "glitter": "S3_URL", ... }
//        Map<String, String> swatchMap = new LinkedHashMap<>();
//        if (nailDesign.getSwatchesJson() != null && !nailDesign.getSwatchesJson().isBlank()) {
//            try {
//                JsonNode swatchNode = objectMapper.readTree(nailDesign.getSwatchesJson());
//                swatchNode.fields().forEachRemaining(e -> swatchMap.put(e.getKey(), e.getValue().asText()));
//            } catch (Exception e) {
//                System.err.println("swatchesJson 파싱 실패: " + e.getMessage());
//            }
//        }
//
//        return DesignGenerateResponseDto.Details.builder()
//                .colorPalette(colorPalette)
//                .textures(new ArrayList<>(textures))
//                .nailParts(buildNailPartsWithImages(nailDesign, nailParts))
//                .swatches(swatchMap.isEmpty() ? null : swatchMap)
//                .build();
//    }

    private void addIfMeaningful(Set<String> target, String value) {
        if (value == null) return;
        String trimmed = value.trim();
        if (trimmed.isEmpty()) return;
        if ("none".equalsIgnoreCase(trimmed) || "null".equalsIgnoreCase(trimmed)) return;
        target.add(trimmed);
    }

    private LinkedHashSet<String> extractTexturesFromPrompt(String prompt) {
        LinkedHashSet<String> textures = new LinkedHashSet<>();
        if (prompt == null || prompt.isBlank()) return textures;
        String lower = prompt.toLowerCase();
        TEXTURE_KEYWORD_MAP.forEach((keyword, textureKey) -> {
            if (lower.contains(keyword)) textures.add(textureKey);
        });
        return textures;
    }

    // FingerDesignPlanService의 motif/parts 어휘 목록 전체 (핵심 요소 "없음" 강제 후처리용)
    private static final List<String> MOTIF_PARTS_VOCAB = List.of(
            "bow ribbon", "star", "heart", "flower", "butterfly", "cross", "bunny",
            "leaf", "shell", "character", "lettering",
            "rhinestone", "pearl bead", "pearl trim", "bow charm 3d",
            "star charm", "heart charm", "metal stud", "chain"
    );

    /**
     * motif "없음"을 명시적으로 고른 경우(스캔/사진 기반 제외), 시스템 프롬프트
     * 지시만으로는 GPT가 여전히 motif/parts를 채워 넣는 경우가 있어서, plan JSON을
     * 직접 후처리해서 5개 손가락 전부 motif/parts 배열을 비우고, description 문장 중
     * 장식 관련 문장도 제거한다.
     */
    private void stripMotifPartsIfExplicitlyDeclined(JsonNode plan, boolean shouldStrip) {
        if (!shouldStrip || !(plan instanceof ObjectNode)) return;
        for (String finger : List.of("thumb", "index", "middle", "ring", "pinky")) {
            JsonNode fingerNode = plan.path(finger);
            if (!(fingerNode instanceof ObjectNode fingerObj)) continue;
            fingerObj.putArray("motif");
            fingerObj.putArray("parts");
            String description = fingerObj.path("description").asText("");
            if (!description.isBlank()) {
                fingerObj.put("description", stripDecorationSentences(description));
            }
        }
    }

    private String stripDecorationSentences(String description) {
        String[] sentences = description.split("(?<=[.!?])\\s+");
        StringBuilder kept = new StringBuilder();
        for (String sentence : sentences) {
            boolean hasForbiddenWord = MOTIF_PARTS_VOCAB.stream().anyMatch(vocab ->
                    java.util.regex.Pattern.compile("(?i)\\b" + java.util.regex.Pattern.quote(vocab) + "\\b")
                            .matcher(sentence).find());
            if (!hasForbiddenWord) {
                if (kept.length() > 0) kept.append(" ");
                kept.append(sentence);
            }
        }
        return kept.toString();
    }

    // ★ 사용자가 mood를 안 골랐을 때(특히 스캔 기반 흐름)의 기본값 후보 풀.
    // 예전엔 무조건 "simple"로 고정해서 [design richness]의 "심플 예외"가 항상 걸리는 바람에
    // 5개 손가락이 색상 문구만 다른 거의 동일한 디자인으로만 나왔다. simple도 여전히
    // 후보에 남겨두되(가끔은 심플해도 되니까), 매번 강제되지 않도록 무작위로 고른다.
    private static final List<String> DEFAULT_MOOD_POOL = List.of(
            "chic", "elegant", "cute", "lovely", "delicate", "modern", "pure", "feminine", "simple"
    );

    private String pickDefaultMood(Map<String, SlotData> slots) {
        String designType = getLiked(slots, "designType").isEmpty() ? null : getLiked(slots, "designType").get(0);
        if ("glitter".equals(designType) || "marble".equals(designType)) return "chic";
        return DEFAULT_MOOD_POOL.get(new Random().nextInt(DEFAULT_MOOD_POOL.size()));
    }

    private void fillMissingFromScan(Map<String, SlotData> slots, HandScan handScan) {
        if (handScan == null) {
            if (getLiked(slots, "mood").isEmpty()) {
                addLiked(slots, "mood", pickDefaultMood(slots));
            }
            return;
        }

        if (getLiked(slots, "shape").isEmpty() && scanRecommendedShape(handScan) != null) {
            addLiked(slots, "shape", scanRecommendedShape(handScan));
        }

        // ★ color는 GPT에게 "30개 중 골라줘"로 넘기면 안 된다 — 실제로 해보니 GPT가 매번
        // 거의 같은 색(가장 무난해 보이는 1개)을 최우선으로 고르는 편향이 있어서, 30개
        // 팔레트를 넘겨도 첫 번째 색이 항상 똑같이 나오는 문제가 있었다. 대신 여기 Java
        // 쪽에서 팔레트 전체(30개)에서 실제로 무작위로 1~3개를 뽑아 확정해버려서, 매
        // 생성마다 색 조합 자체가 달라지도록 한다.
        if (getLiked(slots, "color").isEmpty()) {
            List<String> palette = scanRecommendedColors(handScan);
            if (!palette.isEmpty()) {
                List<String> shuffled = new ArrayList<>(palette);
                Collections.shuffle(shuffled);
                int count = Math.min(shuffled.size(), 1 + new Random().nextInt(3)); // 1~3개
                for (String color : shuffled.subList(0, count)) {
                    addLiked(slots, "color", color);
                }
            }
        }

        if (getLiked(slots, "mood").isEmpty()) {
            addLiked(slots, "mood", pickDefaultMood(slots));
        }
    }

    private void addLiked(Map<String, SlotData> slots, String category, String value) {
        SlotData slot = slots.computeIfAbsent(category, k -> new SlotData());
        if (!slot.getLiked().contains(value)) slot.getLiked().add(value);
    }

    private void backfillSlotsFromPlan(Map<String, SlotData> slots, JsonNode plan) {
        backfillOne(slots, "shape", plan);
        backfillOne(slots, "mood", plan);
        backfillOne(slots, "season", plan);
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
            overrides.fields().forEachRemaining(entry ->
                    sb.append(entry.getKey()).append(": ").append(entry.getValue().asText()).append("\n"));
            return sb.toString();
        } catch (Exception e) { return ""; }
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
        } catch (Exception e) { return ""; }
    }

    /**
     * 채팅에서 사용자가 직접 입력한 원문을 plan 생성에 그대로 넘긴다. 슬롯(카테고리)으로 변환되는
     * 과정에서 "큐빅 넣어줘" 같은 구체 요청이 누락/희석되는 문제를 막기 위한 안전장치.
     */
    private String buildUserOwnWordsText(DesignSession session) {
        if (session == null) return "";
        List<String> userMessages = chatMessageRepository.findBySessionOrderBySentAtAsc(session).stream()
                .filter(m -> m.getRole() == ChatMessage.MessageRole.user)
                .map(m -> m.getContent() == null ? "" : m.getContent().trim())
                .filter(c -> !c.isBlank())
                .map(c -> c.length() > 300 ? c.substring(0, 300) : c)
                .toList();
        if (userMessages.isEmpty()) return "";
        int from = Math.max(0, userMessages.size() - 15);
        StringBuilder sb = new StringBuilder("\n[사용자가 채팅에서 직접 입력한 원문 - 구체적 장식/파츠/색/위치 요청은 최우선으로 반영, 절대 누락 금지]\n");
        for (String msg : userMessages.subList(from, userMessages.size())) {
            sb.append("- ").append(msg.replace("\n", " ")).append("\n");
        }
        return sb.toString();
    }

    private String summarizeSlots(Map<String, SlotData> slots, HandScan handScan) {
        StringBuilder sb = new StringBuilder();
        for (String cat : List.of("shape", "mood", "designType", "color", "season", "motif")) {
            List<String> liked = getLiked(slots, cat);
            if (!liked.isEmpty()) {
                if ("color".equals(cat)) {
                    boolean allHex = liked.stream().allMatch(v -> v != null && v.trim().matches("^#?[0-9A-Fa-f]{6}$"));
                    // ★ 헥스 기반 플랜으로 전환: 이름으로 변환하지 않고 헥스를 그대로 넘긴다.
                    // "#"이 빠져 있으면 붙여서 정규화만 한다 (Gemini가 top-level color에 그대로 복사해야 함).
                    List<String> hexOrRaw = allHex
                            ? liked.stream()
                            .map(v -> v.trim().startsWith("#") ? v.trim().toUpperCase() : "#" + v.trim().toUpperCase())
                            .distinct().toList()
                            : liked.stream().distinct().toList();
                    sb.append("color(이미 확정된 헥스코드, 절대 다른 값으로 바꾸지 말고 top-level color 필드에 그대로 복사): ")
                            .append(String.join(", ", hexOrRaw)).append("\n");
                } else {
                    sb.append(cat).append(": ").append(String.join(", ", liked)).append("\n");
                }
            }
            List<String> disliked = slots.containsKey(cat) ? slots.get(cat).getDisliked() : List.of();
            if (disliked != null && !disliked.isEmpty()) {
                sb.append(cat).append(" (피해야 함): ").append(String.join(", ", disliked)).append("\n");
            }
        }

        if (getLiked(slots, "color").isEmpty() && handScan != null) {
            List<String> palette = scanRecommendedColors(handScan);
            if (!palette.isEmpty()) {
                // ★ Gemini가 mood로 "의미"를 보고 고르되, top-level color엔 반드시 헥스를 내야 하므로
                // "헥스 (이름)" 형태로 같이 준다. 이름은 참고용, 실제 출력은 앞의 헥스를 그대로 복사.
                List<String> resolvedNames = colorNameService.resolveColorNames(palette);
                List<String> paired = new ArrayList<>();
                for (int i = 0; i < palette.size(); i++) {
                    String hex = palette.get(i).trim();
                    if (!hex.startsWith("#")) hex = "#" + hex;
                    String name = i < resolvedNames.size() ? resolvedNames.get(i) : "";
                    paired.add(hex.toUpperCase() + (name.isBlank() ? "" : " (" + name + ")"));
                }
                sb.append("color 후보(사용자의 퍼스널컬러 기반 추천 팔레트, mood와 가장 잘 어울리는 것을 고르고 " +
                                "그 앞의 헥스코드를 top-level color 필드에 그대로 사용): ")
                        .append(String.join(", ", paired)).append("\n");
            }
        }

        return sb.toString();
    }

    // buildCombinedPromptFromPlan - description 기반 산문 프롬프트로 전환
    /** 플랜의 5개 손가락에서 쓰인 finish 값을 소문자로 모두 모은다. */
    private List<String> collectPlanFinishes(JsonNode plan) {
        List<String> finishes = new ArrayList<>();
        for (String finger : List.of("thumb", "index", "middle", "ring", "pinky")) {
            JsonNode arr = plan.path(finger).path("finish");
            if (!arr.isArray()) continue;
            arr.forEach(n -> {
                String f = n.asText("").trim().toLowerCase();
                if (!f.isBlank()) finishes.add(f);
            });
        }
        return finishes;
    }

    /**
     * 이번 플랜에서 레퍼런스를 붙일 후보 키: 플랜에 쓰인 마감들 + (번짐 손그림 꽃이 있으면) "flower art".
     * 입체 꽃(sculpted 3d + flower)은 손그림 스타일 레퍼런스와 맞지 않아서 제외한다.
     */
    private List<String> collectReferenceKeys(JsonNode plan) {
        List<String> keys = new ArrayList<>(collectPlanFinishes(plan));
        boolean paintedFlower = false;
        for (String finger : List.of("thumb", "index", "middle", "ring", "pinky")) {
            JsonNode node = plan.path(finger);
            boolean hasFlower = false;
            for (JsonNode m : node.path("motif")) {
                if (m.asText("").toLowerCase().contains("flower")) hasFlower = true;
            }
            if (hasFlower && !fingerHasFinish(node, "sculpted 3d")) paintedFlower = true;
        }
        if (paintedFlower) keys.add(FinishReferenceService.FLOWER_ART);
        return keys;
    }

    /** 손그림(번짐) 꽃이 들어간 손톱인지: 입체 꽃(sculpted 3d)이거나 설명에 큰 꽃을 명시한 경우는 제외. */
    private boolean isPaintedFlowerNail(JsonNode finger) {
        if (fingerHasFinish(finger, "sculpted 3d")) return false;
        String description = finger.path("description").asText("");
        // ★ motif 배열이 기준. 설명 문장 보조 판정에서는 색 이름과 겹치는 단어(rose, bloom 등)를 쓰지 않는다 —
        // "muted rose", "warm rose base"를 꽃으로 오인해서 꽃을 요청하지 않은 체크 디자인에 꽃이 그려졌다.
        boolean hasFlower = finger.path("motif").toString().toLowerCase().contains("flower")
                || java.util.regex.Pattern.compile("(?i)\\b(flowers?|floral|blossoms?|petals?|tulips?|daisy|daisies|peony|peonies)\\b")
                        .matcher(description).find();
        if (!hasFlower) return false;
        return !java.util.regex.Pattern.compile("(?i)\\b(large|big|oversized|giant|bold|statement)\\b")
                .matcher(description).find();
    }

    private boolean fingerHasFinish(JsonNode finger, String finish) {
        JsonNode arr = finger.path("finish");
        if (!arr.isArray()) return false;
        for (JsonNode n : arr) {
            if (finish.equalsIgnoreCase(n.asText("").trim())) return true;
        }
        return false;
    }

    private boolean fingerHasPattern(JsonNode finger) {
        JsonNode arr = finger.path("pattern");
        if (!arr.isArray()) return false;
        for (JsonNode n : arr) {
            String p = n.asText("").trim();
            if (!p.isBlank() && !"none".equalsIgnoreCase(p)) return true;
        }
        return false;
    }

    /**
     * scan-auto 결과 화면에서 "추천 팔레트 중 어떤 색·무드·디자인 타입이 반영됐는지" 표시용 메타데이터.
     * 사용된 색은 플랜 LLM이 고른 색 문구(top-level color + 손가락별 base_color)를 추천 팔레트의
     * 색 이름과 대조해서 판정한다. (생성 응답 시점엔 이미지 추출 팔레트가 아직 없어서 이름 기반이 최선)
     * 디자인 타입/모티프는 손톱별 finish·pattern·motif·parts 값에서 모아 보여준다.
     */
    private DesignGenerateResponseDto.ScanAutoReflection buildScanAutoReflection(HandScan handScan, JsonNode plan) {
        List<String> palette = scanRecommendedColors(handScan);

        StringBuilder chosen =new StringBuilder(plan.path("color").asText("").toLowerCase());
        for (String f : List.of("thumb", "index", "middle", "ring", "pinky")) {
            chosen.append(' ').append(plan.path(f).path("base_color").asText("").toLowerCase());
        }
        String chosenNorm = chosen.toString().replaceAll("[^a-z0-9]", "");

        List<String> used = new ArrayList<>();
        if (!palette.isEmpty() && !chosenNorm.isBlank()) {
            List<String> names;
            try {
                names = colorNameService.resolveColorNames(palette);
            } catch (Exception e) {
                names = palette;
            }
            for (int i = 0; i < palette.size() && i < names.size(); i++) {
                String nameNorm = names.get(i) == null ? "" : names.get(i).toLowerCase().replaceAll("[^a-z0-9]", "");
                if (nameNorm.length() >= 3 && chosenNorm.contains(nameNorm)) {
                    used.add(palette.get(i));
                }
            }
        }

        LinkedHashSet<String> designTypes = new LinkedHashSet<>();
        LinkedHashSet<String> motifs = new LinkedHashSet<>();
        for (String f : List.of("thumb", "index", "middle", "ring", "pinky")) {
            JsonNode finger = plan.path(f);
            for (String field : List.of("finish", "pattern")) {
                for (JsonNode n : finger.path(field)) addIfMeaningful(designTypes, n.asText(""));
            }
            for (String field : List.of("motif", "parts")) {
                for (JsonNode n : finger.path(field)) addIfMeaningful(motifs, n.asText(""));
            }
        }

        return DesignGenerateResponseDto.ScanAutoReflection.builder()
                .recommendedColors(palette)
                .usedColors(used)
                .shape(cleanPlanValue(plan.path("shape").asText("")))
                .mood(cleanPlanValue(plan.path("mood").asText("")))
                .designType(designTypes.isEmpty() ? cleanPlanValue(plan.path("designType").asText(""))
                        : String.join(", ", designTypes))
                .motif(motifs.isEmpty() ? cleanPlanValue(plan.path("motif").asText(""))
                        : String.join(", ", motifs))
                .build();
    }

    /** 스캔의 추천 쉐입 - 로컬 최종 measurements.json 값, 없으면 DB 값. 없거나 공백이면 null. */
    private String scanRecommendedShape(HandScan handScan) {
        String shape = scanResultFileService.recommendedShape(handScan);
        return (shape == null || shape.isBlank()) ? null : shape.trim();
    }

    /** 스캔의 추천 컬러(hex) 목록 - 로컬 최종 measurements.json 값, 없으면 DB 값. 없으면 빈 리스트. */
    private List<String> scanRecommendedColors(HandScan handScan) {
        return scanResultFileService.recommendedColors(handScan);
    }

    /** 플랜 필드 값 정리: 공백/none/null 은 null 로. */
    private String cleanPlanValue(String v) {
        if (v == null) return null;
        String t = v.trim();
        if (t.isEmpty() || "none".equalsIgnoreCase(t) || "null".equalsIgnoreCase(t)) return null;
        return t;
    }

    /**
     * 스캔 정보 기반 자동 생성 전용 "확정된 입력 정보" 텍스트.
     * 사용자가 취향을 하나도 입력하지 않았으므로, 채팅 "?" 패널에 그대로 노출되는
     * 스캔 분석 결과(추천 쉐입 + 추천 컬러 팔레트 30색)만 근거로 넘긴다.
     *  - 쉐입: recommendedShape 고정 (변경 금지)
     *  - 컬러: 팔레트 전체를 후보로 주고, 그 안에서 서로 어울리는 몇 가지를 플랜 LLM이
     *          직접 고르게 한다. 단색(원컬러) 금지, mood/디자인/모티프는 고른 색에 맞춰
     *          LLM이 스스로 채우고, 5개 손가락에 디테일을 분산시켜 변화를 주도록 지시한다.
     */
    private String buildScanAutoConfirmedSummary(HandScan handScan) {
        StringBuilder sb = new StringBuilder();

        String recShape = scanRecommendedShape(handScan) != null ? scanRecommendedShape(handScan) : "round";
        sb.append("shape(스캔 분석 추천 쉐입 - 반드시 이 값을 그대로 사용하고 절대 다른 쉐입으로 바꾸지 마세요): ")
                .append(recShape).append("\n");

        List<String> palette = scanRecommendedColors(handScan);
        if (!palette.isEmpty()) {
            List<String> names;
            try {
                names = colorNameService.resolveColorNames(palette).stream().distinct().toList();
            } catch (Exception e) {
                names = palette;
            }
            sb.append("color 후보(사용자 퍼스널컬러 분석 기반 추천 팔레트 ").append(palette.size())
                    .append("색 - 이 목록 안에서만 색을 고르세요): ")
                    .append(String.join(", ", names)).append("\n");
        }

        sb.append("""
                [스캔 정보 기반 자동 생성 - 매우 중요]
                - 이 요청은 사용자가 mood/designType/color/motif를 하나도 입력하지 않은 자동 생성입니다.
                - 색은 위 "color 후보" 팔레트 안에서만 고르세요. 팔레트에 없는 색을 창작하거나 추측하지 마세요.
                - 팔레트에서 서로 조화롭게 어울리는 2~4개의 색을 직접 골라 조합하세요.
                  단 한 가지 색으로만 칠한 단색(one-color) 디자인은 절대 만들지 마세요.
                - 고른 색들의 분위기에 맞는 mood / 디자인 / 모티프를 스스로 판단해서 채우세요.
                  (예: 뮤트한 로즈·베이지 조합이면 elegant mood에 gradient나 french tip,
                   맑고 비비드한 조합이면 fresh·funky mood에 color block처럼 색 조합 자체가 드러나는 스타일)
                - 5개 손가락에 위에서 고른 색과 디테일(그라데이션 방향, 마감 차이, 라인/패턴, 포인트 장식 등)을
                  손가락마다 다르게 분산시켜 변화를 주되, 전체적으로는 하나의 세트로 보이도록 통일감을 유지하세요.
                - 최소 2개 이상의 손가락은 base_color를 채우고(서로 다른 색으로), 최소 1개 손가락은
                  parts에 색·분위기와 어울리는 포인트 장식을 하나 이상 넣으세요.
                """);

        return sb.toString();
    }

    private String buildCombinedPromptFromPlan(JsonNode plan, List<String> noPhrases, Map<String, List<String>> fingerDislikesMap,
                                               List<String> referenceFinishes) {
        boolean powderRef = referenceFinishes.contains(FinishReferenceService.POWDER_FINISH);
        boolean flowerRef = referenceFinishes.contains(FinishReferenceService.FLOWER_ART);
        String shape = toPromptText(plan.path("shape").asText("round"));
        String mood    = toPromptText(plan.path("mood").asText(""));
        String season  = toPromptText(plan.path("season").asText(""));
        String surface = toPromptText(plan.path("surface").asText("glossy"));
        // ★ color는 헥스코드이므로 toPromptText(하이픈/언더스코어 치환)를 거치지 않고 그대로 사용
        String colorRaw = plan.path("color").asText("");
        String colorForOverallStyle = Arrays.stream(colorRaw.split(","))
                .map(String::trim).filter(c -> !c.isBlank())
                .collect(Collectors.joining(" and "));

        StringBuilder sb = new StringBuilder();

        sb.append("Create a premium studio product photograph of exactly five individual ")
                .append("press-on nail tips, arranged as one coordinated nail-art set.\n\n");

        // ★ 파우더 레퍼런스(흑백 사진)가 첨부된 경우: 광택만 가져오고 색/무늬/모양은 복사하지 않도록 역할을 제한한다.
        if (powderRef) {
            sb.append("Reference image: the attached grayscale photo is a reference ONLY for the glossiness of ")
                    .append("the powder finish — the wet, smooth, pearly chrome-like gloss and how light reflects ")
                    .append("off the curved nail surface. Apply it only to the nails whose description mentions a ")
                    .append("powder finish. Take only the gloss. Do NOT copy the reference's streaks, swirls, ")
                    .append("veins, cloudy patches, or texture pattern, nor its nail shape, angle, background, ")
                    .append("arrangement, or tones; colors, patterns and decorations come only from the nail ")
                    .append("descriptions below.\n\n");
        }

        // ★ 꽃 스타일 레퍼런스(컬러 크롭 2장): 붓터치/번짐 스타일만 가져오고 꽃 종류/구도/모양은 복사하지 않는다.
        if (flowerRef) {
            sb.append("Flower style reference: the attached small color crops are a reference ONLY for the soft ")
                    .append("painted flower style — loosely brushed, smudged, out-of-focus-looking blooms whose ")
                    .append("pigment has bled and melted into clear gel, with no crisp outlines. Take only that ")
                    .append("soft smudged painting style. Do NOT copy their flower types, composition, nail shapes, ")
                    .append("layout, colors, or background. The flowers to paint are exactly the ones named in the ")
                    .append("nail descriptions below.\n\n");
        }

        sb.append("IMPORTANT:\n")
                .append("Show nail tips only.\n")
                .append("Do not show hands, fingers, skin, wrists, arms, or people.\n")
                .append("Do not place the nail tips on fingers.\n")
                .append("Exactly five nail tips, fully visible and separated from each other.\n\n");

        sb.append("Shape:\n")
                .append("All five nail tips are ").append(shape)
                .append("-shaped press-on nails").append(getShapeProportion(shape))
                .append(". Keep the shape consistent across all five nails.");
        // ★ 방향 고정: 쉐입마다(스틸레토 뾰족한 끝, 발레리나/코핀 평평한 끝 등) 팁이
        // 위/아래로 랜덤하게 나오던 문제 — 모든 손톱이 동일하게 "팁(프리엣지)은 아래,
        // 큐티클 쪽 넓은 끝은 위"를 향하도록 명시해서 방향을 고정한다.
        sb.append(" Every nail tip is oriented vertically the same way: the tip end")
                .append(" (the pointed, tapered, or flat free edge, depending on the shape)")
                .append(" points straight down toward the bottom of the frame, and the wider")
                .append(" cuticle end is at the top. Do not rotate or flip any nail —")
                .append(" all five must share this exact same up/down orientation.");
        sb.append("\n\n");

        List<String> collectedFinishes = new ArrayList<>();
        List<String> collectedPatterns = new ArrayList<>();
        List<String> collectedMotifs   = new ArrayList<>();
        List<String> collectedParts    = new ArrayList<>();
        String[] fingerNames = {"thumb", "index", "middle", "ring", "pinky"};

        // ★ 소용돌이 렌더링은 세트 전체에서 한 가지 방식(입체 젤 또는 평평한 수채화)만 쓴다 — 첫 소용돌이 손톱의 설명으로 결정.
        boolean spiralFlatSet = false;
        for (String name : fingerNames) {
            String desc = plan.path(name).path("description").asText("");
            if (java.util.regex.Pattern.compile("(?i)spiral|swirl").matcher(desc).find()) {
                spiralFlatSet = java.util.regex.Pattern.compile("(?i)watercolor|bleed|feather|flat\\b").matcher(desc).find();
                break;
            }
        }
        final boolean spiralFlat = spiralFlatSet;

        // Nail 1~5 먼저 조립하면서 전체 세트에서 쓰인 항목 수집 (Material section용)
        StringBuilder nailsSection = new StringBuilder();
        for (int i = 0; i < fingerNames.length; i++) {
            JsonNode finger = plan.get(fingerNames[i]);
            nailsSection.append("Nail ").append(i + 1).append(":\n");
            if (finger != null) {
                List<String> dislikes = fingerDislikesMap.getOrDefault(fingerNames[i], List.of());
                nailsSection.append(describeFingerStructured(finger, dislikes,
                        collectedFinishes, collectedPatterns, collectedMotifs, collectedParts));
                // ★ 손톱별 분기: 패턴이 없는 파우더 손톱은 줄무늬/마블이 번지지 않게 단색으로 고정하고,
                // 패턴이 있는 손톱(마블/줄무늬/체크 등)은 패턴을 설명대로 그린 뒤 그 위에 파우더를
                // 투명한 광택막으로 얹는다 (패턴의 출처는 레퍼런스가 아니라 손톱 설명).
                // ★ 마감은 세트 단위로 통일(전체 매트 또는 전체 글로시)이라 손톱별 표면 문장은 없다.
                // ★ 스타일 도구상자 옵션별 확정 문장: GPT 설명만으로는 이미지 모델이 따라오지 않는 옵션
                // (낙서 드로잉 / 블루밍 점 / 자석 유리알)을 해당 손톱 설명 바로 뒤에 붙인다.
                String fingerDescription = finger.path("description").asText("");
                boolean isSpiralNail = java.util.regex.Pattern.compile("(?i)spiral|swirl").matcher(fingerDescription).find();
                boolean isDoodle = java.util.regex.Pattern.compile("(?i)doodle|colou?red[- ]pencil|crayon|childlike")
                        .matcher(fingerDescription).find();
                // ★ 평면 모티프(꽃 제외)는 낙서 아니면 입체 둘 중 하나다. 설명이 둘 다 아니면(예: "refined, shaded" 스타일이라
                // 스티커/데칼처럼 나옴) 낙서로 고정한다.
                boolean hasFlatMotif = false;
                for (JsonNode mo : finger.path("motif")) {
                    String mv = mo.asText("").toLowerCase();
                    if (!mv.isBlank() && !mv.contains("flower") && !mv.equals("none")) hasFlatMotif = true;
                }
                boolean isRaisedOrSoft = java.util.regex.Pattern
                        .compile("(?i)3d|raised|embossed|sculpted|charm|bead|watercolor|blot|bleed|blooming")
                        .matcher(fingerDescription).find();
                if (isDoodle || (hasFlatMotif && !isSpiralNail && !isRaisedOrSoft)) {
                    nailsSection.append(" The drawing is a naive childlike doodle: a simple outline with slightly")
                            .append(" imperfect proportions, but the line itself is perfectly smooth — a solid,")
                            .append(" evenly colored, evenly glossy stroke like a smooth gel pen, with no grain, no")
                            .append(" bumps, no lumps, and no fuzzy pencil texture. It never looks like a sticker,")
                            .append(" decal, or printed clip-art.");
                }
                // ★ 소용돌이/스파이럴: 플래너가 얇은 라인으로 쓰는 경우가 있어서 굵고 짧은 형태를 확정 문장으로 덮어쓴다.
                // 세트 전체에서 입체/수채화 중 한 방식만 쓰고, 동심원이 아니라 중심에서 바깥으로 이어지는 한 줄 나선으로 고정한다.
                if (isSpiralNail) {
                    nailsSection.append(" The spiral is ONE continuous arm that starts at a point in the center and winds")
                            .append(" outward in a single direction like a snail shell or cinnamon roll — not separate")
                            .append(" concentric rings, not a bullseye or target. It is a thick, tightly packed spiral that")
                            .append(" coils for only one and a half to two turns and then ends,");
                    if (spiralFlat) {
                        boolean fullNail = java.util.regex.Pattern
                                .compile("(?i)full[- ]nail|(whole|entire|full) nail|covers? the (whole|entire)")
                                .matcher(fingerDescription).find();
                        nailsSection.append(fullNail
                                ? " covering the whole nail,"
                                : " as a small patch in the center of the nail about half of the nail width across,")
                                .append(" painted flat into the gel with a perfectly smooth, even surface, softly feathered")
                                .append(" edges, and no raised thickness.");
                    } else {
                        nailsSection.append(" centered on the nail and large, about two thirds of the nail width across, made of")
                                .append(" a line about one eighth of the nail width thick with a perfectly smooth, even")
                                .append(" surface and a glossy rounded raised top like a bead of thick gel.");
                    }
                    nailsSection
                            .append(" It is never a thin or hairline stroke, never a long winding line, and never bumpy,")
                            .append(" beaded, or rope-like. This overrides any thinner or longer spiral described above.");
                }
                if (java.util.regex.Pattern.compile("(?i)\\bblooming\\b").matcher(fingerDescription).find()) {
                    nailsSection.append(" The blooming look is made only of soft blurred round dots of pigment inside")
                            .append(" a milky translucent gel, each dot darker in the center with a feathered halo")
                            .append(" bleeding outward and fading to nothing at the rim; the dots may line up to")
                            .append(" trace a curve, ring, or heart outline, but there are no solid filled shapes or")
                            .append(" crisp edges.");
                }
                if (fingerHasFinish(finger, "magnetic cat eye")) {
                    nailsSection.append(" The magnetic gel is a round glass-bead glow: a soft, domed, pearly gleam")
                            .append(" gathered into a rounded blob in the center of the nail with a bright clean")
                            .append(" highlight, never a stripe, band, diagonal line, spiral, or swirl, with no visible")
                            .append(" particles, specks, or sparkle.");
                    if (!java.util.regex.Pattern.compile("(?i)guava|green|pink magnet").matcher(fingerDescription).find()) {
                        nailsSection.append(" The magnetic gleam is silver or champagne gold only — never holographic,")
                                .append(" rainbow, or multi-color iridescent.");
                    }
                }
                // ★ 꽃이 있는 손톱: 크기 지시를 손톱 설명 바로 뒤에 붙여서 확정한다. 전역 "Flower art" 문단만으로는
                // GPT가 쓴 손톱별 설명("dreamy cloud of floral motifs", "flower's center의 큐빅" 등)에 밀려 꽃이 커졌다.
                if (isPaintedFlowerNail(finger)) {
                    nailsSection.append(" Flowers on this nail are painted tiny and heavily smudged: minuscule blurry")
                            .append(" blots of pigment in the flower's own color, each only about one fifteenth of the")
                            .append(" nail width and as small as a sesame seed, with NO petal outlines, NO stems, NO")
                            .append(" line art and no inner detail — just soft out-of-focus blobs with tiny leaf")
                            .append(" smudges, edges softly blurred and melting into the clear gel like wet watercolor but")
                            .append(" staying tight around each blot, never washing its color across the nail or tinting")
                            .append(" the surrounding gel, scattered loosely with most of the clear gel left empty. This overrides any")
                            .append(" larger size, petal, stem, or line-art detail implied above.");
                    if (finger.path("parts").toString().toLowerCase().contains("rhinestone")) {
                        nailsSection.append(" The rhinestones are separate small gems placed beside the tiny blooms;")
                                .append(" do not enlarge the flowers to fit the gems.");
                    }
                }
                if (powderRef && fingerHasFinish(finger, "powder finish")) {
                    if (fingerHasPattern(finger)) {
                        nailsSection.append(" The glossy pearlescent powder finish sits as a thin transparent layer")
                                .append(" over the pattern above; the pattern itself is drawn exactly as described,")
                                .append(" not taken from the reference photo.");
                    } else {
                        nailsSection.append(" Surface: perfectly smooth, solid, uniform color from cuticle to tip with")
                                .append(" a subtle even pearly chrome sheen — no streaks, swirls, marbling, veining,")
                                .append(" or cloudy patches.");
                    }
                }
            }
            nailsSection.append("\n\n");
        }

        // 4. Overall style — 헥스코드 그대로 노출
        sb.append("Overall style:\nTrendy Korean nail art");
        if (!colorForOverallStyle.isBlank()) sb.append(", ").append(colorForOverallStyle).append(" color palette");
        if (!mood.isBlank()) sb.append(", ").append(mood).append(" mood");
        if (!season.isBlank() && !"none".equalsIgnoreCase(season)) sb.append(", ").append(season);
        sb.append(", ").append(surface).append(" finish");
        if (!collectedPatterns.isEmpty() || !collectedMotifs.isEmpty()) {
            List<String> styleSummary = new ArrayList<>();
            styleSummary.addAll(collectedPatterns);
            styleSummary.addAll(collectedMotifs);
            sb.append(" with ").append(String.join(", ", styleSummary)).append(" decorative style");
        }
        sb.append(", luxury press-on nail product design.\n\n");

        sb.append(nailsSection);

        // 10. Material and finish
        sb.append("Material and finish:\n")
                .append(buildMaterialSection(surface, collectedFinishes, collectedParts))
                .append("\n\n");

        // ★ 꽃 모티프: 식물도감 일러스트/스티커처럼 나오지 않게 실제 네일샵의 손그림(번짐) 또는 입체 조형으로 고정
        if (collectedMotifs.stream().anyMatch(m -> m.toLowerCase().contains("flower"))) {
            boolean raised = collectedFinishes.stream().anyMatch(f -> f.toLowerCase().contains("sculpted 3d"));
            sb.append("Flower art:\n");
            if (raised) {
                sb.append("Flowers are simple raised 3D flowers: five soft rounded translucent petals ")
                        .append("with visible thickness, a tiny pearl or crystal center, sitting on top ")
                        .append("of the nail with a subtle contact shadow.\n\n");
            } else {
                // ★ 테스트로 확정한 값: 손톱 폭의 약 1/15(깨알 크기)로 작고, 윤곽 없이 번진 손그림 꽃.
                // 손톱별 description에 크기가 따로 적혀 있으면 그 값을 따른다.
                sb.append("Flowers are drawn TINIER THAN TINY unless a nail's description states a different ")
                        .append("size — minuscule dainty blooms, each only about one fifteenth of the nail width ")
                        .append("and as small as a sesame seed, leaving most of the clear gel empty. They are ")
                        .append("quick hand-painted salon flowers, soft and smudged: each bloom is just a loose ")
                        .append("rounded blotch of its own color with only a hint of petal shape, no petal ")
                        .append("outlines, no petal veins, no inner detail, edges feathered and blurred as if the ")
                        .append("wet pigment bled into the gel, with a couple of tiny simple green leaf strokes. ")
                        .append("They look slightly out of focus, like watercolor dropped on wet paper, under the ")
                        .append("glossy top coat — not a botanical illustration and not a printed decal.\n\n");
            }
        }

        sb.append("Composition:\n")
                .append("Arrange exactly five nail tips in a neat horizontal group, ")
                .append("similar size and proportion, each nail completely visible, no overlap, ")
                .append("centered composition, large amount of clean white negative space, ")
                .append("tips_only_flatlay presentation.\n\n");

        sb.append("Photography:\n")
                .append("Shot as a real macro product photograph on a professional camera ")
                .append("(Canon EOS R5, 100mm f/2.8 macro lens), the kind of photo a Korean nail ")
                .append("artist posts on Instagram or Pinterest to sell a press-on set — not a 3D ")
                .append("render, not CGI, not a digital illustration, not flat vector art, not clip ")
                .append("art, not a cartoon or plastic-toy look, not a smooth game-asset render.\n\n")
                .append("Lighting: a soft studio softbox at a low angle wraps gently around the curved ")
                .append("surface of each nail with soft bounce fill in the shadows — the exact highlight ")
                .append("shape (a sharp glassy streak for glossy/chrome/jelly finishes, or an even pearly ")
                .append("chrome sheen over the whole nail with natural reflections for powder finishes, ")
                .append("without changing the nail's color) ")
                .append("should follow whatever each nail's own material description above specifies, ")
                .append("rendered with real-photo specular realism. Where the nail is jelly, milky, or ")
                .append("translucent, render real light transmission — light glows softly from within ")
                .append("the clear gel and the white background is faintly visible through the ")
                .append("translucent edges, like real gel catching light, never a flat opaque pastel ")
                .append("coating.\n\n")
                .append("Clean seamless white background, soft gentle shadow beneath each nail, ")
                .append("shallow depth of field with tack-sharp macro focus on the nail surfaces, ")
                .append("true-to-life color rendering. Subtle imperfections typical of real handmade ")
                .append("gel nail polish — faint visible brush texture, slightly uneven gloss sheen, ")
                .append("tiny natural variation between the five nails. Unless the design explicitly ")
                .append("calls for glitter, render every reflective or shimmery surface as a smooth, ")
                .append("continuous, mirror-like gloss — never as scattered glitter specks or sparkle ")
                .append("dust. This must read as an unedited raw photograph from a real Korean nail ")
                .append("salon portfolio, not a hyper-polished catalog render and not a smooth cartoon ")
                .append("illustration.");

        if (!noPhrases.isEmpty())
            sb.append("\n\nAvoid: ").append(String.join(", ", noPhrases)).append(".");

        String result = sb.toString();
        System.out.println("최종 완성 프롬프트(통합): " + result);
        return result;
    }


    // describeFingerStructured - description 자유 문장을 우선 사용, 없으면 배열 조립으로 폴백
    private String describeFingerStructured(JsonNode finger, List<String> fingerDislikes,
                                            List<String> collectedFinishes, List<String> collectedPatterns,
                                            List<String> collectedMotifs, List<String> collectedParts) {

        // 검출/Material 섹션용으로 배열은 항상 수집 (description 사용 여부와 무관)
        List<String> finishes = toTextList(finger.path("finish"));
        List<String> patterns = toTextList(finger.path("pattern"));
        List<String> motifs   = toTextList(finger.path("motif"));
        List<String> parts    = toTextList(finger.path("parts"));

        finishes.forEach(f -> { if (!collectedFinishes.contains(f)) collectedFinishes.add(f); });
        patterns.forEach(p -> { if (!collectedPatterns.contains(p)) collectedPatterns.add(p); });
        motifs.forEach(m -> { if (!collectedMotifs.contains(m)) collectedMotifs.add(m); });
        parts.forEach(p -> { if (!collectedParts.contains(p)) collectedParts.add(p); });

        String description = finger.path("description").asText("").trim();

        StringBuilder sb = new StringBuilder();
        if (!description.isBlank()) {
            // ★ 핵심 경로: Gemini가 쓴 자유 산문 그대로 사용 (색상은 이미 자연어로 되어 있어야 함)
            sb.append(description);
        } else {
            // 폴백: description이 비어 있으면 예전처럼 배열을 기계적으로 조립
            String baseColorOverride = toPromptText(finger.path("base_color").asText(""));
            if (!baseColorOverride.isBlank()) sb.append(baseColorOverride).append(".");

            List<String> descriptors = new ArrayList<>();
            descriptors.addAll(finishes);
            descriptors.addAll(patterns);
            if (!descriptors.isEmpty())
                sb.append(" ").append(String.join(" with ", descriptors)).append(".");

            List<String> decorations = new ArrayList<>();
            decorations.addAll(motifs);
            decorations.addAll(parts);
            if (!decorations.isEmpty())
                sb.append(" Add ").append(String.join(" and ", decorations)).append(".");
        }

        if (!fingerDislikes.isEmpty())
            sb.append(" Avoid: ").append(fingerDislikes.stream()
                    .map(this::toPromptText).collect(Collectors.joining(", "))).append(".");

        return sb.toString().trim();
    }

    private List<String> toTextList(JsonNode arrayNode) {
        List<String> result = new ArrayList<>();
        if (arrayNode != null && arrayNode.isArray()) {
            arrayNode.forEach(n -> {
                String tag = toPromptText(n.asText().trim());
                if (!tag.isBlank()) result.add(tag);
            });
        }
        return result;
    }

    private String getShapeProportion(String shape) {
        return switch (shape.toLowerCase()) {
            case "stiletto"  -> " with sharp elegant proportions";
            case "almond"    -> " with slightly elongated proportions";
            case "ballerina" -> " with long flat-tipped proportions";
            case "oval"      -> " with soft rounded proportions";
            case "square"   -> " with clean straight-edged proportions";
            case "round"    -> " with natural rounded proportions";
            default -> "";
        };
    }

    private String buildMaterialSection(String surface, List<String> finishes, List<String> parts) {
        List<String> items = new ArrayList<>();
        boolean isMatte = surface.toLowerCase().contains("matte");
        items.add(isMatte ? "matte finish" : "glossy gel polish");
        // ★ 항상 "시럽젤" 스타일 투명감을 언급 — jelly가 선택 안 돼도 요즘 트렌드인 시럽젤
        // (두껍고 촉촉해 보이는 유리질 투명 젤, 손톱 색이 은은히 비치는) 느낌이 없으면
        // 이미지가 납작한 스티커/오페이크 페인트처럼 나옴.
        String finishLower = finishes.stream().map(String::toLowerCase).collect(Collectors.joining(" "));
        String partsLower  = parts.stream().map(String::toLowerCase).collect(Collectors.joining(" "));

        // ★ 시럽(jelly)은 이제 손톱별로 고르는 색 표현 중 하나라서, 시럽 손톱이 있을 때만 투명 시럽젤 문구를 넣고
        // 솔리드 손톱은 불투명하게 둔다. 시럽이 없으면 광택 있는 젤 깊이감만 가볍게 언급한다.
        if (!isMatte) {
            if (finishLower.contains("jelly")) {
                items.add("thick glossy syrup-gel texture on the nails described as syrup — a wet-looking, " +
                        "glass-clear translucent gel layer with a large soft mirror-like highlight, the nail bed " +
                        "color subtly glowing through the translucent gel, like a trending Korean syrup-gel " +
                        "manicure; nails described as solid stay opaque and even");
            } else {
                items.add("glossy gel with real depth and natural light refraction, not flat paint");
            }
        }

        if (finishLower.contains("jelly"))          items.add("translucent jelly layers");
        if (finishLower.contains("glitter"))        items.add("ultra-fine micro glitter on the nails described with glitter — tiny dust-fine, densely " +
                "scattered sparkles giving a delicate even shimmer, never large flakes or hexagon confetti");
        if (finishLower.contains("chrome"))         items.add("metallic chrome sheen");
        // ★ 자석젤은 유리알 광택이 기본(입자 없음) — 글리터와 구분한다.
        if (finishLower.contains("magnetic cat eye"))
            items.add("round glass-bead magnetic gel glow on the nails described as magnetic — a soft domed pearly " +
                    "gleam gathered in the center of the nail with a bright clean highlight, in silver or " +
                    "champagne gold only, never a stripe or swirl, with no visible particles or sparkle");
        if (finishLower.contains("foil"))           items.add("metallic foil accents");
        // ★ "iridescent powder shimmer"였을 때 이미지 모델이 "shimmer"를 잔글리터로 해석해서
        // 매끈한 크롬 파우더 대신 반짝이 가루처럼 나오던 문제 — glitter를 명시적으로 금지.
        if (finishLower.contains("powder finish"))
            // ★ 목표 레퍼런스는 "오로라 펄 파우더": 손톱 중앙을 따라 가늘고 밝은 진주빛 흰 띠(거울 반사)가
            // 선명하게 뻗고, 양옆으로 핑크/라일락 펄 그라데이션이 번지는 실제 사진 같은 광택.
            // 부드러운 헤이즈 버전은 새틴처럼 납작하게 나와서 "파우더 느낌이 별로"였음.
            // ★ 부정문을 길게 나열하면 이미지 모델이 오히려 그 개념(자석젤/글리터)을 떠올림 —
            // 짧은 긍정문 위주로 쓰고 글리터 금지만 한 번 명시한다.
            items.add("full-cover glossy chrome pearlescent powder finish — a smooth, even mother-of-pearl " +
                    "chrome sheen across the entire nail surface in the nail's own color (never tinting " +
                    "the base color), sealed under a glossy top coat, no glitter specks");
        if (finishLower.contains("sculpted 3d") || partsLower.contains("charm"))
            items.add("realistic sculpted 3d decorations, dimensional charms");
        if (partsLower.contains("pearl"))      items.add("realistic pearl beads");
        if (partsLower.contains("rhinestone")) items.add("subtle rhinestone reflections");
        if (partsLower.contains("metal stud")) items.add("realistic metal stud accents");
        if (partsLower.contains("chain"))      items.add("delicate metal chain detail");

        items.add("fine nail-art details");
        items.add("premium handmade Korean nail-art appearance");

        return String.join(", ", items) + ".";
    }


    /**
     * 스와치 생성용 전체 프롬프트 조합
     * 원본 combinedPrompt + 수정 내역(fingerOverrides)을 합쳐서 반환
     */
    private String buildFullPromptForSwatch(NailDesign design) {
        if (design.getSession() != null) {
            String sessionPrompt = design.getSession().getGeneratedPrompt();
            String fingerOverrides = design.getSession().getFingerOverrides();

            if (sessionPrompt != null && !sessionPrompt.isBlank()) {
                if (fingerOverrides != null && !fingerOverrides.isBlank()) {
                    // 원본 프롬프트 + 수정된 손가락 내역 합산
                    return sessionPrompt + "\n[Finger modifications]: " + fingerOverrides;
                }
                return sessionPrompt;
            }
        }
        // 세션 없는 경우 (채팅 없이 직접 생성된 디자인)
        return design.getPromptSummary();
    }

    public List<String> extractKeywordsFromSlots(Map<String, SlotData> slots, DesignSession session) {
        List<String> keywords = new ArrayList<>();
        for (String cat : List.of("mood", "designType", "motif", "season", "shape")) {
            List<String> liked = getLiked(slots, cat);
            liked.stream()
                    .filter(v -> v != null && !v.isBlank() && !"none".equalsIgnoreCase(v) && !"상관없음".equalsIgnoreCase(v))
                    .forEach(keywords::add);
        }
        // color는 hex → 이름 변환
        List<String> colors = getLiked(slots, "color");
        if (!colors.isEmpty()) {
            try {
                colorNameService.resolveColorNames(colors)
                        .stream()
                        .filter(v -> v != null && !v.isBlank())
                        .forEach(keywords::add);
            } catch (Exception e) {
                colors.forEach(keywords::add); // 변환 실패 시 hex 그대로
            }
        }
        return keywords;
    }
}