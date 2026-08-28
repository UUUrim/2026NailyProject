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

    // ★ 신규: ComfyUI 대체 서비스
    private final NailImageService nailImageService;
    private final NailDetectionService nailDetectionService;
    private final TextureExtractService textureExtractService;
    private final TextureSwatchService textureSwatchService;

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
                             ChatMessageRepository chatMessageRepository,
                             NailImageService nailImageService,
                             NailDetectionService nailDetectionService,
                             TextureExtractService textureExtractService,
                             TextureSwatchService textureSwatchService) {
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

    /**
     * ★ 핵심 교체: ComfyUI → gen 서버 + detect 서버
     * - nailImageService.generateNailImage() 로 이미지 base64 취득
     * - S3 업로드
     * - nailDetectionService.extractColorsPerNail() 로 컬러 팔레트 추출
     */
    public NailDesign generateDesign(Long userId, String prompt, String negativePrompt, DesignSession session) throws Exception {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found: " + userId));

        // 1. gen 서버에서 이미지 생성 (base64 반환)
        long seed = (long) (Math.random() * Long.MAX_VALUE);
        String imageBase64 = nailImageService.generateNailImage(prompt, seed);

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
                .aiModel("z-image-turbo + lora-v1 (diffusers)")
                .status(NailDesign.DesignStatus.DRAFT)
                .nailTipCropsJson(nailTipCropsJson)
                .seed(seed)
                .build();

        return nailDesignRepository.save(design);
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
    private String toPromptText(String value) {
        return value.replace("-", " ");
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
        } else if (handScan.getRecommendedShape() != null && !handScan.getRecommendedShape().isBlank()) {
            finalShape = handScan.getRecommendedShape();
        } else {
            finalShape = "round";
        }

        List<String> finalDesigns = getLiked(slots, "designType");
        List<String> finalColors  = getLiked(slots, "color");
        if (finalColors.isEmpty() && handScan.getRecommendedColors() != null) {
            try {
                finalColors = objectMapper.readValue(handScan.getRecommendedColors(),
                        objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));
            } catch (JsonProcessingException ignored) {}
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
                    // ★ 파츠 검출
                    try {
                        if (design.getDesignPlan() != null) {
                            JsonNode planNode = objectMapper.readTree(design.getDesignPlan());
                            triggerPartsDetection(design, planNode);
                        }
                    } catch (Exception e) {
                        System.err.println("[Parts] 파츠 검출 실패: " + e.getMessage());
                    }

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

        record TimelineEntry(java.time.LocalDateTime time, int order, com.example.nailyproject.dto.response.ChatMessageResponseDto dto) {}
        List<TimelineEntry> timeline = new ArrayList<>();

        for (ChatMessage m : chatMessageRepository.findBySessionOrderBySentAtAsc(design.getSession())) {
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
            return (shape == null || shape.isBlank()) ? null : shape;
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

        fillMissingFromScan(slots, handScan);

        if (session != null) {
            session.updateExtractedPreferences(objectMapper.writeValueAsString(slots));
        }

        String summary = summarizeSlots(slots, handScan)
                + buildFingerInstructionText(session != null ? session.getFingerOverrides() : null)
                + buildFingerDislikeInstructionText(session != null ? session.getFingerDislikes() : null);

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
        JsonNode plan = fingerDesignPlanService.generatePlan(summary, imageBase64, imageMimeType, previousPlanJson, userSeasonForTrend);

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

        String combinedPrompt = buildCombinedPromptFromPlan(plan, noPhrases, fingerDislikesMap);

        if (session != null) {
            session.updateGeneratedPrompt(combinedPrompt);
        }

        // ★ gen 서버로 이미지 생성 (ComfyUI 대체)
        NailDesign nailDesign = generateDesign(user.getId(), combinedPrompt, finalNegative, session);

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
                .build();
    }

    /**
     * ★ buildDetails: colorPalette + designPlan 파싱 + swatchesJson 포함
     */
    public DesignGenerateResponseDto.Details buildDetails(NailDesign nailDesign) {
        // colorPalette 파싱
        List<String> colorPalette = new ArrayList<>();
        if (nailDesign.getColorPalette() != null && !nailDesign.getColorPalette().isBlank()) {
            try {
                colorPalette = objectMapper.readValue(nailDesign.getColorPalette(),
                        objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));
            } catch (Exception e) {
                System.err.println("colorPalette 파싱 실패: " + nailDesign.getColorPalette());
            }
        }

        // designPlan에서 textures, nailParts 추출
        LinkedHashSet<String> textures  = new LinkedHashSet<>();
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
                            for (JsonNode part : parts) addIfMeaningful(nailParts, part.asText(""));
                        }
                    }
                }
            } catch (Exception e) {
                System.err.println("designPlan 파싱 실패: " + e.getMessage());
            }
        }

        // ★ swatchesJson 파싱: { "glitter": "S3_URL", ... }
        Map<String, String> swatchMap = new LinkedHashMap<>();
        if (nailDesign.getSwatchesJson() != null && !nailDesign.getSwatchesJson().isBlank()) {
            try {
                JsonNode swatchNode = objectMapper.readTree(nailDesign.getSwatchesJson());
                swatchNode.fields().forEachRemaining(e -> swatchMap.put(e.getKey(), e.getValue().asText()));
            } catch (Exception e) {
                System.err.println("swatchesJson 파싱 실패: " + e.getMessage());
            }
        }

        return DesignGenerateResponseDto.Details.builder()
                .colorPalette(colorPalette)
                .textures(new ArrayList<>(textures))
                .nailParts(buildNailPartsWithImages(nailDesign, nailParts))
                .swatches(swatchMap.isEmpty() ? null : swatchMap)
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
            if (getLiked(slots, "mood").isEmpty()) {
                String designType = getLiked(slots, "designType").isEmpty() ? null : getLiked(slots, "designType").get(0);
                String defaultMood = ("glitter".equals(designType) || "marble".equals(designType)) ? "chic" : "simple";
                addLiked(slots, "mood", defaultMood);
            }
            return;
        }

        if (getLiked(slots, "shape").isEmpty() && handScan.getRecommendedShape() != null && !handScan.getRecommendedShape().isBlank()) {
            addLiked(slots, "shape", handScan.getRecommendedShape());
        }

        if (getLiked(slots, "color").isEmpty() && handScan.getRecommendedColors() != null) {
            try {
                List<String> palette = objectMapper.readValue(handScan.getRecommendedColors(),
                        objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));
                if (!palette.isEmpty()) {
                    String randomColor = palette.get(new Random().nextInt(palette.size()));
                    addLiked(slots, "color", randomColor);
                }
            } catch (JsonProcessingException ignored) {}
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

    private String summarizeSlots(Map<String, SlotData> slots, HandScan handScan) {
        StringBuilder sb = new StringBuilder();
        for (String cat : List.of("shape", "mood", "designType", "color", "season", "motif")) {
            List<String> liked = getLiked(slots, cat);
            if (!liked.isEmpty()) {
                if ("color".equals(cat)) {
                    boolean allHex = liked.stream().allMatch(v -> v != null && v.trim().matches("^#?[0-9A-Fa-f]{6}$"));
                    List<String> resolvedNames = allHex
                            ? colorNameService.resolveColorNames(liked).stream().distinct().toList()
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
                    List<String> resolvedPalette = colorNameService.resolveColorNames(palette);
                    sb.append("color 후보(사용자의 퍼스널컬러 기반 추천 팔레트, 이 중에서 mood와 가장 잘 어울리는 것을 선택): ")
                            .append(String.join(", ", resolvedPalette)).append("\n");
                }
            } catch (JsonProcessingException ignored) {}
        }

        return sb.toString();
    }

    private String buildCombinedPromptFromPlan(JsonNode plan, List<String> noPhrases, Map<String, List<String>> fingerDislikesMap) {
        String shape = toPromptText(plan.path("shape").asText("round"));
        // ballerina → coffin (프롬프트에서만)
        if ("ballerina".equalsIgnoreCase(shape)) shape = "coffin";
        String mood = plan.path("mood").asText("");
        String season = plan.path("season").asText("");
        String overallColor = plan.path("color").asText("");
        String overallDesignType = plan.path("designType").asText("");
        String overallMotif = plan.path("motif").asText("");

        List<String> parts = new ArrayList<>();
        parts.add("A studio product photo of five " + shape + "-shaped press-on nail tips arranged in a perfectly straight horizontal line with equal spacing between each tip");
        parts.add("nailart");

        if (!overallDesignType.isBlank()) parts.add(toPromptText(overallDesignType));
        if (!overallColor.isBlank()) parts.add(toPromptText(overallColor) + " base color");
        if (!overallMotif.isBlank() && !"none".equalsIgnoreCase(overallMotif)) parts.add(toPromptText(overallMotif) + " motif");

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

        parts.add("placed with generous spacing and no overlapping, each charm must have perfectly defined sharp edges and clean precise shape");

        if (!mood.isBlank()) parts.add(toPromptText(mood) + " mood");
        if (!season.isBlank() && !"none".equalsIgnoreCase(season)) parts.add(toPromptText(season));
        if (!noPhrases.isEmpty()) parts.add(String.join(", ", noPhrases));

        parts.add("top-down flat lay view");
        parts.add("plain white background");
        parts.add(hasExplicitTextRequest
                ? "no shadow, no hands, no fingers, no watermark, no reflection"
                : "no shadow, no hands, no fingers, no text, no watermark, no reflection");
        parts.add("product shot");

        List<String> sanitizedParts = parts.stream().map(p -> p.replace("\\\"", "\"")).toList();
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

        boolean isEmpty = designType.isBlank() && baseColor.isBlank()
                && "none".equalsIgnoreCase(motif) && !hasParts && fingerDislikes.isEmpty();
        if (isEmpty) return null;

        List<String> descriptors = new ArrayList<>();
        if (!designType.isBlank()) descriptors.add(toPromptText(designType));
        if (!baseColor.isBlank()) descriptors.add(toPromptText(baseColor));

        String designTypeLower = designType.toLowerCase();
        if (hasParts) {
            List<String> partTags = new ArrayList<>();
            partsList.forEach(p -> {
                String tag = toPromptText(p.asText());
                if (!tag.isBlank() && !designTypeLower.contains(tag.toLowerCase())) partTags.add(tag);
            });
            if (!partTags.isEmpty()) descriptors.add("with " + String.join(" and ", partTags));
        } else if (!"none".equalsIgnoreCase(motif)) {
            descriptors.add("with " + toPromptText(motif));
        }

        String base = fingerName + " features " + String.join(" ", descriptors);

        if (!fingerDislikes.isEmpty()) {
            String withoutPart = fingerDislikes.stream().map(this::toPromptText).collect(Collectors.joining(" or "));
            base = base + " without " + withoutPart;
        }

        return base;
    }


    /**
     * plan에서 파츠 이름 추출 → detect 서버 /parts 호출 (비동기 fire-and-forget)
     */
    private void triggerPartsDetection(NailDesign nailDesign, JsonNode plan) {
        List<String> partNames = extractPartNamesFromPlan(plan);
        if (partNames.isEmpty()) {
            System.out.println("[Parts] plan에 파츠 없음, 검출 스킵");
            return;
        }

        // ★ nailTipCropsJson에서 개별 손톱 크롭 URL 가져오기
        NailDesign freshDesign = nailDesignRepository.findById(nailDesign.getId()).orElse(nailDesign);
        String nailTipCropsJson = freshDesign.getNailTipCropsJson();
        if (nailTipCropsJson == null || nailTipCropsJson.isBlank()) {
            System.out.println("[Parts] nailTipCropsJson 없음, 전체 이미지로 폴백");
            // 기존 방식 (전체 이미지)
            triggerPartsDetectionFallback(nailDesign, partNames);
            return;
        }

        final Long designId = nailDesign.getId();

        new Thread(() -> {
            try {
                List<String> cropUrls = objectMapper.readValue(nailTipCropsJson,
                        objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));

                Map<String, List<String>> allPartsUrlMap = new LinkedHashMap<>();

                // ★ 각 손톱 크롭에서 파츠 탐지
                for (String cropUrl : cropUrls) {
                    byte[] cropBytes = s3Service.downloadImageBytes(cropUrl);
                    String cropBase64 = Base64.getEncoder().encodeToString(cropBytes);

                    Map<String, List<String>> detected = nailDetectionService.detectParts(cropBase64, partNames);

                    // 결과 병합 (같은 파츠명이면 첫 번째 인스턴스만)
                    for (Map.Entry<String, List<String>> entry : detected.entrySet()) {
                        if (!allPartsUrlMap.containsKey(entry.getKey()) && !entry.getValue().isEmpty()) {
                            List<String> urls = new ArrayList<>();
                            String cropBase64Result = entry.getValue().get(0);
                            if (cropBase64Result != null && !cropBase64Result.isBlank()) {
                                byte[] partBytes = Base64.getDecoder().decode(cropBase64Result);
                                String s3Key = "designs/user_" + nailDesign.getUser().getId()
                                        + "/parts_" + entry.getKey().replace(" ", "_")
                                        + "_" + designId + "_0.png";
                                String url = s3Service.uploadImageBytes(partBytes, s3Key);
                                urls.add(url);
                            }
                            if (!urls.isEmpty()) allPartsUrlMap.put(entry.getKey(), urls);
                        }
                    }
                }

                // DB 저장
                if (!allPartsUrlMap.isEmpty()) {
                    nailDesignRepository.findById(designId).ifPresent(d -> {
                        try {
                            d.updatePartsJson(objectMapper.writeValueAsString(allPartsUrlMap));
                            nailDesignRepository.save(d);
                            System.out.println("[Parts] 검출 완료 저장 designId=" + designId);
                        } catch (Exception e) {
                            System.err.println("[Parts] DB 저장 실패: " + e.getMessage());
                        }
                    });
                }
            } catch (Exception e) {
                System.err.println("[Parts] 파츠 검출 실패 designId=" + designId + ": " + e.getMessage());
            }
        }, "parts-detect-" + designId).start();
    }

    private void triggerPartsDetectionFallback(NailDesign nailDesign, List<String> partNames) {
        String imageUrl = (nailDesign.getImageUrls() != null && !nailDesign.getImageUrls().isEmpty())
                ? nailDesign.getImageUrls().get(0) : null;
        if (imageUrl == null) return;

        final Long designId = nailDesign.getId();

        new Thread(() -> {
            try {
                byte[] imageBytes = s3Service.downloadImageBytes(imageUrl);
                String imageBase64 = Base64.getEncoder().encodeToString(imageBytes);

                Map<String, List<String>> detected = nailDetectionService.detectParts(imageBase64, partNames);

                Map<String, List<String>> partsUrlMap = new LinkedHashMap<>();
                for (Map.Entry<String, List<String>> entry : detected.entrySet()) {
                    if (entry.getValue().isEmpty()) continue;
                    String cropBase64 = entry.getValue().get(0);
                    if (cropBase64 == null || cropBase64.isBlank()) continue;
                    try {
                        byte[] cropBytes = Base64.getDecoder().decode(cropBase64);
                        String s3Key = "designs/user_" + nailDesign.getUser().getId()
                                + "/parts_" + entry.getKey().replace(" ", "_")
                                + "_" + designId + "_0.png";
                        String url = s3Service.uploadImageBytes(cropBytes, s3Key);
                        partsUrlMap.put(entry.getKey(), List.of(url));
                    } catch (Exception e) {
                        System.err.println("[Parts] 크롭 S3 업로드 실패: " + e.getMessage());
                    }
                }

                if (!partsUrlMap.isEmpty()) {
                    nailDesignRepository.findById(designId).ifPresent(d -> {
                        try {
                            d.updatePartsJson(objectMapper.writeValueAsString(partsUrlMap));
                            nailDesignRepository.save(d);
                            System.out.println("[Parts] 검출 완료 저장 designId=" + designId);
                        } catch (Exception e) {
                            System.err.println("[Parts] DB 저장 실패: " + e.getMessage());
                        }
                    });
                }
            } catch (Exception e) {
                System.err.println("[Parts] 파츠 검출 실패 designId=" + designId + ": " + e.getMessage());
            }
        }, "parts-detect-fallback-" + designId).start();
    }

    private List<String> extractPartNamesFromPlan(JsonNode plan) {
        List<String> parts = new ArrayList<>();

        for (String fingerName : List.of("thumb", "index", "middle", "ring", "pinky")) {
            JsonNode finger = plan.get(fingerName);
            if (finger == null) continue;

            JsonNode partsList = finger.path("parts");
            if (partsList.isArray()) {
                partsList.forEach(p -> {
                    String raw = p.asText().trim();
                    if (!raw.toLowerCase().contains("3d")) return;
                    String part = simplifyPartName(raw);
                    if (!part.isBlank() && !parts.contains(part)) {
                        parts.add(part);
                    }
                });
            }
        }
        return parts;
    }

    private String simplifyPartName(String part) {
        if (part.isBlank()) return part;

        // 리본 → bow 치환
        String simplified = part.replaceAll("(?i)\\bribbon\\b", "bow");

        // 형용사/수식어 제거
        simplified = simplified
                .replaceAll("(?i)\\b(large|small|tiny|oversized|3D|iridescent|metallic|crystal|glossy|matte|clear|embedded|holographic|internal|fine|soft|smooth|subtle|shaped|single|double|sculpted|multifaceted|icy|chrome|silver|gold)\\b", "")
                .replaceAll("(?i)\\b(charm|chrome|accent|detail|finish|texture|pattern|effect|art|coat|base|tip|stud|cluster|bead|rhinestone|gem|stone|crystal|sphere|orb|line)\\b", "")
                .replaceAll("(?i)\\b(with|and|of|from|at|in|the|a|an)\\b", " ")
                .replaceAll("(?i)-shaped", "")
                .replaceAll("-", " ")
                .replaceAll("\\s+", " ")
                .trim();

        // 중복 단어 제거 후 앞 2단어만
        String[] words = simplified.split(" ");
        List<String> unique = new ArrayList<>();
        for (String w : words) {
            if (!unique.contains(w)) unique.add(w);
        }
        simplified = String.join(" ", unique.subList(0, Math.min(2, unique.size())));

        return simplified + " on nail tip";
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

    private List<Object> buildNailPartsWithImages(NailDesign nailDesign, LinkedHashSet<String> nailParts) {
        // partsJson 없으면 텍스트 파츠만 반환
        if (nailDesign.getPartsJson() == null || nailDesign.getPartsJson().isBlank()) {
            return new ArrayList<>(nailParts);
        }
        // partsJson 있으면 이미지 파츠만 사용 (텍스트 파츠 제외 — 중복 방지)
        List<Object> result = new ArrayList<>();
        try {
            JsonNode partsNode = objectMapper.readTree(nailDesign.getPartsJson());
            partsNode.fields().forEachRemaining(entry -> {
                JsonNode urlsNode = entry.getValue();
                if (urlsNode.isArray() && urlsNode.size() > 0) {
                    String url = urlsNode.get(0).asText();  // 첫 번째 인스턴스만
                    if (!url.isBlank()) {
                        Map<String, String> partItem = new LinkedHashMap<>();
                        partItem.put("label", entry.getKey());
                        partItem.put("imageUrl", url);
                        result.add(partItem);
                    }
                }
            });
        } catch (Exception e) {
            System.err.println("partsJson 파싱 실패: " + e.getMessage());
        }
        return result;
    }
}