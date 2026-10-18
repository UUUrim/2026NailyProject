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
    private final KeywordTranslationService keywordTranslationService;
    // 색상
//    private final JsonColorMapper jsonColorMapper;


    private static final String BASE_NEGATIVE_PROMPT =
            "hands, fingers, skin, blurry, low quality, watermark, text, bad anatomy, deformed, ugly, dots, polka dot, stripes, dark colors, bold colors, tweezers, tools, props, gray background, colored background";

    private static final Map<String, String> TEXTURE_KEYWORD_MAP = new LinkedHashMap<>();
    static {
        // 스와치 베이스 이미지가 있는 재료 키만 (ink는 베이스 이미지 등록 전까지 제외, powder는 chrome으로 통합)
        TEXTURE_KEYWORD_MAP.put("syrup",        "syrup");
        TEXTURE_KEYWORD_MAP.put("glitter",      "glitter");
        TEXTURE_KEYWORD_MAP.put("knit",         "knit");
        TEXTURE_KEYWORD_MAP.put("velvet",       "knit");
        TEXTURE_KEYWORD_MAP.put("chrome sheen", "chrome");
        TEXTURE_KEYWORD_MAP.put("powder",       "chrome");
        TEXTURE_KEYWORD_MAP.put("aurora",       "chrome");
        TEXTURE_KEYWORD_MAP.put("magnetic",     "magnetic_chrome");
        TEXTURE_KEYWORD_MAP.put("cat eye",      "magnetic_chrome");
        TEXTURE_KEYWORD_MAP.put("mercury",      "mercury_chrome");
        TEXTURE_KEYWORD_MAP.put("matte",        "matte");
        TEXTURE_KEYWORD_MAP.put("3d charm",     "3d_charm");
        TEXTURE_KEYWORD_MAP.put("solid color",  "plain_solid");
    }

    @org.springframework.beans.factory.annotation.Value("${analysis.server.url:http://localhost:8000}")
    private String analysisServerUrl;

    // "디자인 생성하기"가 실제 이미지를 어디서 만들지 고르는 토글. diffusers(기본, 기존 gen 서버) / comfy / gptimage.
    // application.yml의 naily.image-provider로 바꾸고 재시작하면 됨(런타임 전환 아님).
    @org.springframework.beans.factory.annotation.Value("${naily.image-provider:diffusers}")
    private String imageProvider;

    // gptimage 요청에 background=transparent / output_format=png를 추가할지.
    // 켜면 프롬프트도 투명 배경용 문구로 바뀐다(흰 배경 / 그림자 / "배경이 비친다" 문구 제거 - 남겨두면 모델이 흰 배경을 그려서
    // 투명 요청이 무시된다). AR 크롭은 투명 원본의 알파로 만들어지고, 끄면 흰 배경 이미지에서 로컬 누끼를 딴다.
    @org.springframework.beans.factory.annotation.Value("${naily.gpt-image-transparent:true}")
    private boolean gptImageTransparent;

    private boolean useTransparentGptImage() {
        return gptImageTransparent && "gptimage".equalsIgnoreCase(imageProvider);
    }

    /** 이미지 생성/수정을 투명 배경으로 요청하는 설정인지(RefineService가 수정 요청에도 똑같이 적용한다). */
    public boolean isTransparentGptImage() {
        return useTransparentGptImage();
    }

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
                             ScanResultFileService scanResultFileService,
                             KeywordTranslationService keywordTranslationService) {
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
        this.keywordTranslationService = keywordTranslationService;
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
        if (session != null) session.recordDesignScan(handScan);

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
        // gptimage는 투명 배경 PNG로 생성한다 (AR용 원본). 화면에 보여줄 이미지는 아래에서 흰 배경을 입혀 따로 만든다.
        boolean transparentImage = false;
        if ("gptimage".equalsIgnoreCase(imageProvider)) {
            transparentImage = useTransparentGptImage();
            List<byte[]> references = finishReferenceService.referencesFor(referenceFinishes);
            if (references.isEmpty()) {
                imageBase64 = gptClientService.generateImage(prompt, "1536x1024", "auto", transparentImage);
            } else {
                try {
                    imageBase64 = gptClientService.generateImageWithReferences(prompt, "1536x1024", "auto", references, transparentImage);
                } catch (Exception e) {
                    System.err.println("[NailDesignService] 레퍼런스 첨부 생성 실패, 텍스트만으로 재시도: " + e.getMessage());
                    imageBase64 = gptClientService.generateImage(prompt, "1536x1024", "auto", transparentImage);
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
        //    표시용 이미지는 흰 배경을 입힌 버전, 투명 원본(imageBase64)은 AR 네일팁 크롭에만 쓴다.
        byte[] imageBytes = Base64.getDecoder().decode(imageBase64);
        String displayBase64 = imageBase64;
        if (transparentImage) {
            // 투명 배경을 요청했어도 모델이 무시하고 불투명(흰/오프화이트 배경) 이미지를 줄 수 있다. 어느 쪽인지 남겨둔다.
            System.out.println("[GptImage] background=transparent 요청 → 응답: " + PngBackground.describeAlpha(imageBytes));
        }
        if (transparentImage) {
            // 모델 출력 그대로(알파 보정 없음): AR 크롭은 투명 원본, 표시용은 거기에 흰 배경을 입힌 것
            imageBytes = PngBackground.compositeOnWhite(imageBytes);
            displayBase64 = Base64.getEncoder().encodeToString(imageBytes);
        }
        String s3Key = "designs/user_" + userId + "/" + UUID.randomUUID() + ".png";
        String s3Url = s3Service.uploadImageBytes(imageBytes, s3Key);


        // 4. 손가락별 네일팁 매트 이미지 추출 → S3 업로드 후 URL 리스트 JSON
        //    (AR 미리보기가 로컬 세그멘테이션 대신 이걸 우선 사용 - nailDesignAsset.ts 참고)
        //    로컬 누끼는 투명 원본의 알파를 그대로 쓰고, detect 서버 폴백에는 흰 배경 버전을 보낸다.
        String nailTipCropsJson = fetchAndUploadNailTipCrops(userId, imageBase64, displayBase64);

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

    /**
     * 손가락별 AR 네일팁 크롭을 만들어 S3에 올리고 URL 목록 JSON을 돌려준다(실패하면 null).
     * 생성(generateDesign)과 수정(RefineService)이 똑같이 쓴다 - 크롭이 없는 디자인은 AR이 프론트의 색 기반 누끼로
     * 폴백하는데, 이 누끼는 흰색으로 번지는 손톱 끝을 배경으로 오인해서 잘라낸다.
     *
     * @param imageBase64    투명 원본(투명 모드) 또는 생성 이미지 - 로컬 누끼가 알파/색으로 손톱을 가른다
     * @param fallbackBase64 로컬 누끼가 실패했을 때 detect 서버로 보낼 흰 배경 이미지
     */
    public String createNailTipCrops(Long userId, String imageBase64, String fallbackBase64) {
        return fetchAndUploadNailTipCrops(userId, imageBase64, fallbackBase64);
    }

    /** 크롭 보강을 이미 시도한 디자인(서버가 떠 있는 동안 디자인당 한 번만 - 실패해도 열 때마다 다시 하지 않는다). */
    private final java.util.Set<Long> cropBackfillTried = java.util.concurrent.ConcurrentHashMap.newKeySet();

    /**
     * 네일팁 크롭이 없는 디자인(수정으로 만든 디자인, 크롭 추출이 실패했던 디자인, 옛날 디자인)에 크롭을 만들어 저장한다.
     * 이런 디자인은 AR이 프론트의 색 기반 누끼로 폴백해서 흰색 손톱 끝이 잘린다. 열어 볼 때 한 번 서버에서 만들어 두면
     * 다음부터는 저장된 크롭을 그대로 쓴다. 상세 조회 중에 도는 일이라 로컬 누끼만 쓴다(탐지 서버 폴백은 응답이 멈출 수 있다).
     */
    private void ensureNailTipCrops(NailDesign design) {
        if (design.getNailTipCropsJson() != null && !design.getNailTipCropsJson().isBlank()) return;
        if (design.getImageUrls() == null || design.getImageUrls().isEmpty()) return;
        if (!cropBackfillTried.add(design.getId())) return;
        try {
            byte[] bytes = s3Service.downloadImageBytes(design.getImageUrls().get(0));
            String base64 = Base64.getEncoder().encodeToString(bytes);
            List<NailSheetSegmenter.Nail> local = nailDetectionService.segmentNailsLocally(base64);
            if (local == null || local.size() != NailSheetSegmenter.NAIL_COUNT) {
                System.out.println("[NailTipCrops] designId=" + design.getId() + " 크롭이 없고 로컬 누끼로도 5개를 못 찾아 보강하지 못했습니다.");
                return;
            }
            Long userId = design.getUser().getId();
            List<String> urls = new ArrayList<>();
            for (int i = 0; i < local.size(); i++) {
                String s3Key = "designs/user_" + userId + "/nail-tips-ordered/" + UUID.randomUUID() + "_" + i + ".png";
                urls.add(s3Service.uploadImageBytes(local.get(i).cropPng(), s3Key));
            }
            design.updateNailTipCropsJson(objectMapper.writeValueAsString(urls));
            nailDesignRepository.save(design);
            System.out.println("[NailTipCrops] designId=" + design.getId() + " 크롭이 없어 새로 만들어 저장했습니다 (로컬 누끼).");
        } catch (Exception e) {
            System.err.println("[NailTipCrops] designId=" + design.getId() + " 크롭 보강 실패: " + e.getMessage());
        }
    }

    private String fetchAndUploadNailTipCrops(Long userId, String imageBase64, String fallbackBase64) {
        try {
            // 투명(또는 흰) 배경 위 5개 시트라 SAM 없이 픽셀 연산으로 먼저 따고, 5개를 못 찾을 때만 detect 서버로 폴백한다.
            List<NailSheetSegmenter.Nail> local = nailDetectionService.segmentNailsLocally(imageBase64);
            if (local != null && local.size() == NailSheetSegmenter.NAIL_COUNT) {
                System.out.println("[NailTipCrops] 로컬(Java) 누끼 성공: " + local.size() + "개 — detect 서버 호출 안 함");
                List<String> urls = new ArrayList<>();
                for (int i = 0; i < local.size(); i++) {
                    String s3Key = "designs/user_" + userId + "/nail-tips-ordered/" + UUID.randomUUID() + "_" + i + ".png";
                    urls.add(s3Service.uploadImageBytes(local.get(i).cropPng(), s3Key));
                }
                return objectMapper.writeValueAsString(urls);
            }
            System.out.println("[NailTipCrops] 로컬 누끼 실패 → detect 서버로 폴백");

            Map<String, List<String>> parts = nailDetectionService.detectParts(fallbackBase64, List.of("nail tip"));
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
    public void confirmDesign(User user, Long designId,
                              List<com.example.nailyproject.dto.request.ChatTranscriptEntryDto> chatTranscript) {
        NailDesign design = nailDesignRepository.findById(designId)
                .orElseThrow(() -> new IllegalArgumentException("해당 디자인을 찾을 수 없습니다."));

        if (!design.getUser().getId().equals(user.getId())) {
            throw new IllegalArgumentException("본인의 디자인만 확정할 수 있습니다.");
        }

        // 확정하는 순간 채팅 화면에 보이던 대화를 이 디자인의 채팅 이력으로 저장한다 (화면 표시용 — GPT 대화·생성에는 안 쓴다)
        boolean transcriptSaved = false;
        if (chatTranscript != null && !chatTranscript.isEmpty()) {
            try {
                design.updateChatTranscriptJson(
                        objectMapper.writeValueAsString(resolveTranscriptReferencePhotos(design, chatTranscript)));
                transcriptSaved = true;
            } catch (JsonProcessingException e) {
                System.err.println("[ChatTranscript] 채팅 화면 대화 저장 실패: " + e.getMessage());
            }
        }

        if (design.getStatus() == NailDesign.DesignStatus.DRAFT) {
            design.updateStatus(NailDesign.DesignStatus.CONFIRMED);
            nailDesignRepository.save(design);
        } else if (transcriptSaved) {
            nailDesignRepository.save(design);
        }

        // ★ 컬러 추출 — 동기 (확정 응답 전에 완료되어야 프론트에서 바로 보임)
        try {
            byte[] imgBytes = s3Service.downloadImageBytes(design.getImageUrls().get(0));
            String imgBase64 = Base64.getEncoder().encodeToString(imgBytes);
            List<Map<String, Object>> perNailColors = nailDetectionService.extractColorsPerNailLocalFirst(imgBase64);
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

                        // mercury_chrome도 SwatchColorizer가 base64 이미지를 돌려주므로 다른 스와치와 똑같이 S3에 올린다
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

        // 확정할 때 채팅 화면 대화를 저장해 뒀으면 그대로 돌려준다 (실제로 나눈 대화 화면과 똑같이 다시 그리기 위함).
        // 저장된 게 없는 예전 디자인은 아래처럼 서버에 남은 메시지와 생성 이력으로 이력을 조립한다.
        List<com.example.nailyproject.dto.response.ChatMessageResponseDto> savedTranscript = readSavedChatTranscript(design);
        if (savedTranscript != null) return savedTranscript;

        if (design.getSession() == null) return List.of();

        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
        Long sessionId = design.getSession().getId();

        // ★ "디자인 재생성하기"로 같은 세션을 이어서 쓰면, 이 디자인 이후에 이어서 만든 대화/디자인도
        // 같은 세션에 쌓인다. 그대로 다 보여주면 원본 디자인 이력에 나중에 이어서 수정한 내용까지
        // 섞여 보이므로, 이 디자인이 생성된 시점(generatedAt) 이후의 항목은 잘라낸다.
        java.time.LocalDateTime cutoff = design.getGeneratedAt();

        record TimelineEntry(java.time.LocalDateTime time, int order, com.example.nailyproject.dto.response.ChatMessageResponseDto dto) {}
        List<TimelineEntry> timeline = new ArrayList<>();

        String photoRequestContent = PHOTO_REQUEST_TEXT; // 참고 사진 말풍선 문구(코멘트가 있으면 함께 표시)
        for (ChatMessage m : chatMessageRepository.findBySessionOrderBySentAtAsc(design.getSession())) {
            if (cutoff != null && m.getSentAt() != null && m.getSentAt().isAfter(cutoff)) continue;
            if (m.getRole() == ChatMessage.MessageRole.user && m.getContent() != null
                    && m.getContent().startsWith(PHOTO_REQUEST_TEXT + "\n")) {
                if (PHOTO_REQUEST_TEXT.equals(photoRequestContent)) photoRequestContent = m.getContent(); // 첫 번째 것만 사용
                continue; // 별도 말풍선으로는 보여주지 않음
            }
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
                                .content(photoRequestContent)
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

    // 채팅 화면 대화의 참고 사진 자리 — 프론트는 사진 미리보기(data URL, 수 MB)를 보내지 않고 이 값만 보낸다
    private static final String REFERENCE_PHOTO_PLACEHOLDER = "reference-photo";

    /**
     * 채팅 화면 대화의 참고 사진 자리표시자를 이 세션에서 실제로 올린 참고 사진(S3) URL로 바꾼다.
     * 사진을 여러 번 올렸으면 뒤에서부터(가장 최근 것끼리) 짝짓는다 — 생성에 실패한 앞쪽 시도는 사진 URL이 남지 않아서.
     * 짝이 없는 자리표시자는 버리고, 그래서 글도 이미지도 없어진 말풍선은 뺀다.
     */
    private List<com.example.nailyproject.dto.request.ChatTranscriptEntryDto> resolveTranscriptReferencePhotos(
            NailDesign design, List<com.example.nailyproject.dto.request.ChatTranscriptEntryDto> transcript) {
        List<String> photoUrls = design.getSession() == null ? List.of()
                : nailDesignRepository.findBySessionIdOrderByGeneratedAtAsc(design.getSession().getId()).stream()
                .filter(d -> design.getGeneratedAt() == null || d.getGeneratedAt() == null
                        || !d.getGeneratedAt().isAfter(design.getGeneratedAt()))
                .map(NailDesign::getReferenceImageUrl)
                .filter(url -> url != null && !url.isBlank())
                .distinct()
                .toList();
        long placeholderCount = transcript.stream()
                .filter(entry -> entry.getImageUrls() != null)
                .flatMap(entry -> entry.getImageUrls().stream())
                .filter(REFERENCE_PHOTO_PLACEHOLDER::equals)
                .count();
        int photoIndex = (int) (photoUrls.size() - placeholderCount);

        List<com.example.nailyproject.dto.request.ChatTranscriptEntryDto> resolved = new ArrayList<>();
        for (com.example.nailyproject.dto.request.ChatTranscriptEntryDto entry : transcript) {
            List<String> imageUrls = null;
            if (entry.getImageUrls() != null) {
                imageUrls = new ArrayList<>();
                for (String url : entry.getImageUrls()) {
                    if (REFERENCE_PHOTO_PLACEHOLDER.equals(url)) {
                        if (photoIndex >= 0 && photoIndex < photoUrls.size()) imageUrls.add(photoUrls.get(photoIndex));
                        photoIndex++;
                    } else if (url != null && !url.startsWith("data:")) {
                        imageUrls.add(url);
                    }
                }
            }
            boolean hasContent = (entry.getContent() != null && !entry.getContent().isBlank())
                    || (imageUrls != null && !imageUrls.isEmpty())
                    || (entry.getColorSwatches() != null && !entry.getColorSwatches().isEmpty());
            if (!hasContent) continue;
            resolved.add(new com.example.nailyproject.dto.request.ChatTranscriptEntryDto(
                    entry.getRole(), entry.getContent() != null ? entry.getContent() : "", imageUrls,
                    entry.getColorSwatches(), entry.getColorsInline(), entry.getTextAfterColors(),
                    entry.getDesignResult(), entry.getHistoryOnly(), entry.getChatOnly(),
                    entry.getHistorySection(), entry.getGenerationMethod()));
        }
        return resolved;
    }

    /** 확정 때 저장한 채팅 화면 대화를 이력 응답 형태로 읽는다. 저장된 게 없거나 읽지 못하면 null. */
    private List<com.example.nailyproject.dto.response.ChatMessageResponseDto> readSavedChatTranscript(NailDesign design) {
        String json = design.getChatTranscriptJson();
        if (json == null || json.isBlank()) return null;
        try {
            List<com.example.nailyproject.dto.request.ChatTranscriptEntryDto> entries = objectMapper.readValue(json,
                    new com.fasterxml.jackson.core.type.TypeReference<List<com.example.nailyproject.dto.request.ChatTranscriptEntryDto>>() {});
            return entries.stream()
                    .map(entry -> com.example.nailyproject.dto.response.ChatMessageResponseDto.builder()
                            .role(entry.getRole())
                            .content(entry.getContent() != null ? entry.getContent() : "")
                            .sentAt("")
                            .imageUrls(entry.getImageUrls())
                            .colorSwatches(entry.getColorSwatches())
                            .colorsInline(entry.getColorsInline())
                            .textAfterColors(entry.getTextAfterColors())
                            .designResult(entry.getDesignResult())
                            .historyOnly(entry.getHistoryOnly())
                            .chatOnly(entry.getChatOnly())
                            .historySection(entry.getHistorySection())
                            .generationMethod(entry.getGenerationMethod())
                            .build())
                    .toList();
        } catch (JsonProcessingException e) {
            System.err.println("[ChatTranscript] 저장된 채팅 화면 대화를 읽지 못해 예전 방식으로 이력을 만듭니다: " + e.getMessage());
            return null;
        }
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

        if (isOwner) ensureNailTipCrops(design);

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

        // 사진 기반 생성이면 색은 참고 사진에서 읽는다. 스캔 추천 팔레트를 랜덤으로 확정색에 박으면
        // 플랜 LLM이 "확정 헥스"를 그대로 따라서 사진의 색감이 무시되므로, 이때는 쉐입/무드만 스캔 값으로 메운다.
        boolean hasImage = imageBase64 != null && !imageBase64.isBlank();

        // scan-auto가 아니면 기존대로 빈 슬롯을 스캔 값으로 메운다.
        // (scan-auto는 아래 buildScanAutoConfirmedSummary로 팔레트 전체를 넘기므로,
        //  여기서 랜덤 단색 하나를 슬롯에 박아넣으면 원컬러 디자인으로 굳어져 버린다.)
        if (!scanAuto) {
            fillMissingFromScan(slots, handScan, !hasImage);
        }

        if (session != null && !scanAuto) {
            session.updateExtractedPreferences(objectMapper.writeValueAsString(slots));
        }

        String summary = scanAuto
                ? buildScanAutoConfirmedSummary(handScan)
                : summarizeSlots(slots, handScan, !hasImage)
                + buildFingerInstructionText(session != null ? session.getFingerOverrides() : null)
                + buildFingerDislikeInstructionText(session != null ? session.getFingerDislikes() : null)
                + buildUserOwnWordsText(session)
                + buildPhotoNoteText(request.getUserNote());

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
        JsonNode plan = fingerDesignPlanService.generatePlan(
                summary, imageBase64, imageMimeType, previousPlanJson, userSeasonForTrend, scanAuto);

        // scan-auto: 쉐입은 "?" 패널에 표시된 스캔 분석 추천 쉐입으로 강제 고정한다.
        // 플랜 생성 LLM이 다른 쉐입을 넣더라도 덮어써서, 최종 프롬프트 / AR 3D 템플릿 /
        // 저장되는 designPlan 이 모두 패널 값과 정확히 일치하도록 한다.
        if (scanAuto && plan != null && plan.isObject() && scanRecommendedShape(handScan) != null) {
            ((ObjectNode) plan).put("shape", scanRecommendedShape(handScan));
        }

        // 앱이 제공하는 쉐입은 6가지(round/oval/almond/stiletto/ballerina/square)뿐이다. 플랜 LLM이 사진을 보고
        // "rounded square" 같은 새 이름을 적으면 프롬프트와 AR 3D 템플릿(파일명 매칭)이 어긋나므로, 항상 6가지 중 하나로 정리한다.
        enforceAppShape(plan, getLiked(slots, "shape"), handScan != null ? scanRecommendedShape(handScan) : null);

        // scan-auto: top-level color(= 최종 프롬프트 Overall style의 헥스)를 추천 팔레트 값으로 정규화한다.
        // LLM이 헥스를 살짝 바꿔 쓰거나 이름만 적어도, 프롬프트에 쓰인 색과 결과 화면의 "반영된 추천 컬러"
        // 표시가 항상 팔레트 안의 같은 색을 가리키도록 한다.
        if (scanAuto && plan != null && plan.isObject()) {
            snapPlanColorsToPalette((ObjectNode) plan, scanRecommendedColors(handScan));
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
        List<String> referenceKeys = collectReferenceKeys(plan);
        List<String> referenceFinishes = "gptimage".equalsIgnoreCase(imageProvider)
                ? finishReferenceService.availableFinishes(referenceKeys)
                : List.of();
        if ("gptimage".equalsIgnoreCase(imageProvider)) {
            // 레퍼런스 파일이 없으면 조용히 텍스트만으로 생성돼서 "적용이 안 된 줄 몰랐던" 일이 있었다 - 로그로 알린다.
            List<String> missingReferences = finishReferenceService.configuredButMissing(referenceKeys);
            if (!missingReferences.isEmpty()) {
                System.err.println("[FinishReference] 레퍼런스 이미지 파일이 없어 텍스트만으로 생성합니다: " + missingReferences
                        + " → Backend/src/main/resources/finish-refs/ 를 확인하세요.");
            }
            if (!referenceFinishes.isEmpty()) {
                System.out.println("[FinishReference] 마감 레퍼런스를 첨부해 생성합니다: " + referenceFinishes);
            }
        }

        String combinedPrompt = buildCombinedPromptFromPlan(plan, noPhrases, fingerDislikesMap, referenceFinishes);

        if (session != null) {
            session.updateGeneratedPrompt(combinedPrompt);
        }

        // 사진과 함께 보낸 사용자 코멘트를 채팅 이력에 저장한다 (마이페이지 "채팅 이력 보기"에서 보이도록).
        // 디자인 생성(저장) 직전에 저장해야 이 디자인의 generatedAt 이전 시점이라 이력 조회에서 잘리지 않는다.
        savePhotoRequestMessage(session, hasImage, request.getUserNote());

        // 결과 화면 키워드(영어 슬롯·플랜 값)를 미리 모아, 사전에 없는 말의 한글 번역(GPT)을 이미지를 만드는 동안 끝내 둔다
        List<String> resultKeywords = mergeKeywords(referenceSubjectKeyword(plan),
                mergeKeywords(extractKeywordsFromSlots(slots, session), extractPlanKeywords(plan)));
        List<String> translationCandidates = new ArrayList<>(resultKeywords);
        translationCandidates.addAll(extractKeywordsFromSlots(slots, session)); // slotKeywords (resultKeywords는 개수 제한이 있다)
        if (scanAuto) translationCandidates.addAll(scanReflectionValues(plan));
        prefetchKeywordTranslations(translationCandidates);

        // ★ gen 서버로 이미지 생성 (ComfyUI 대체)
        NailDesign nailDesign = generateDesign(user.getId(), combinedPrompt, finalNegative, session, referenceFinishes);
        // 디자인 생성에 쓰인 손 분석 기록 — 채팅 이력에서 지워도 남아, 마이페이지가 이 기록을 지우지 못하게 한다
        if (session != null && handScan != null) session.recordDesignScan(handScan);

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
                .keywords(localizeKeywords(resultKeywords)) //디자인결과화면 선택옵션 단어 (슬롯 + 플랜의 마감/패턴/모티프/파츠)
                .keywordColors(extractKeywordColors(slots))
                // 선택지 기반 결과 화면이 "기타" 의견에서 나온 키워드를 자유 입력과 같은 방식으로 보여 줄 때 쓴다 (표시 전용)
                .slotKeywords(extractSlotKeywords(slots, session))
                .scanAutoReflection(scanAuto ? buildScanAutoReflection(handScan, plan) : null)
                .referenceImageUrl(nailDesign.getReferenceImageUrl())
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
        fillMissingFromScan(slots, handScan, true);
    }

    /** @param useScanColors false면 색은 건드리지 않는다(사진 기반 생성: 색은 참고 사진에서 읽는다). */
    private void fillMissingFromScan(Map<String, SlotData> slots, HandScan handScan, boolean useScanColors) {
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
        if (useScanColors && getLiked(slots, "color").isEmpty()) {
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
     * 사진 기반 생성에서 사용자가 사진과 함께 적은 추가 요청. 사진의 분위기/색감을 기본으로 하되
     * 이 요청(예: "수채화 느낌을 잘 살려줘")은 사진 해석보다 우선해 반영하도록 plan 생성에 넘긴다.
     */
    private static final String PHOTO_REQUEST_TEXT = "이 사진으로 만들어줘";

    /** 사진 기반 생성의 사용자 발화를 "이 사진으로 만들어줘\n<코멘트>" 형태로 저장. 코멘트가 없으면 저장하지 않는다. */
    private void savePhotoRequestMessage(DesignSession session, boolean hasImage, String note) {
        if (session == null || !hasImage || note == null || note.isBlank()) return;
        String trimmed = note.trim();
        if (trimmed.length() > 300) trimmed = trimmed.substring(0, 300);
        chatMessageRepository.save(ChatMessage.builder()
                .session(session)
                .role(ChatMessage.MessageRole.user)
                .content(PHOTO_REQUEST_TEXT + "\n" + trimmed)
                .build());
    }

    private String buildPhotoNoteText(String note) {
        if (note == null || note.isBlank()) return "";
        String trimmed = note.trim();
        if (trimmed.length() > 300) trimmed = trimmed.substring(0, 300);
        return "\n[사용자가 참고 사진과 함께 직접 적은 추가 요청 - 사진의 색감/분위기를 바탕으로 하되, 이 요청의 느낌/질감/장식/위치는 최우선으로 반영, 절대 누락 금지]\n- "
                + trimmed.replace("\n", " ") + "\n";
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
                .map(c -> c.length() > 500 ? c.substring(0, 500) : c) // 선택 요약 + 기타 입력이 함께 오는 메시지가 잘리지 않게 500자
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
        return summarizeSlots(slots, handScan, true);
    }

    /** @param useScanPalette false면 "color 후보"(스캔 추천 팔레트)를 넘기지 않는다(사진 기반 생성). */
    private String summarizeSlots(Map<String, SlotData> slots, HandScan handScan, boolean useScanPalette) {
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

        if (useScanPalette && getLiked(slots, "color").isEmpty() && handScan != null) {
            List<String> palette = scanRecommendedColors(handScan);
            if (!palette.isEmpty()) {
                sb.append("color 후보(사용자의 퍼스널컬러 기반 추천 팔레트, mood와 가장 잘 어울리는 것을 고르고 " +
                                "그 앞의 헥스코드를 top-level color 필드에 그대로 사용): ")
                        .append(String.join(", ", pairHexWithNames(palette))).append("\n");
            }
        }

        return sb.toString();
    }

    /**
     * 추천 팔레트를 "#HEX (이름)" 목록으로 만든다. 플랜 LLM이 이름으로 색의 "의미"를 보고 고르되,
     * top-level color엔 반드시 헥스를 내야 하므로 둘을 같이 준다. 이름은 참고용, 실제 출력은 앞의 헥스를 그대로 복사.
     */
    private List<String> pairHexWithNames(List<String> palette) {
        List<String> resolvedNames;
        try {
            resolvedNames = colorNameService.resolveColorNames(palette);
        } catch (Exception e) {
            resolvedNames = List.of();
        }
        List<String> paired = new ArrayList<>();
        for (int i = 0; i < palette.size(); i++) {
            String name = i < resolvedNames.size() ? resolvedNames.get(i) : "";
            paired.add(normalizeHex(palette.get(i)) + (name == null || name.isBlank() ? "" : " (" + name + ")"));
        }
        return paired;
    }

    /** "e8b4c0" / "#e8b4c0" → "#E8B4C0" */
    private String normalizeHex(String hex) {
        String h = hex.trim().toUpperCase();
        return h.startsWith("#") ? h : "#" + h;
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
        // ★ 우아한 무드 + 체크(plaid) 패턴이 있으면 우아한 체크 레퍼런스를 붙인다.
        boolean plaidNail = false;
        for (String finger : List.of("thumb", "index", "middle", "ring", "pinky")) {
            if (arrayHasValue(plan.path(finger).path("pattern"), "plaid")) plaidNail = true;
        }
        if (plaidNail && plan.path("mood").toString().toLowerCase().contains("elegant")) {
            keys.add(FinishReferenceService.ELEGANT_CHECK);
        }
        return keys;
    }

    /** 손그림(번짐) 꽃이 들어간 손톱인지: 입체 꽃(sculpted 3d)이거나 설명에 큰 꽃을 명시한 경우는 제외. */
    /** 평면(그린) 리본 손톱인가: 모티프가 리본이고 입체/양각이 아니다. */
    private boolean isDrawnRibbonNail(JsonNode finger) {
        if (fingerHasFinish(finger, "sculpted 3d")) return false;
        if (finger.path("parts").toString().toLowerCase().contains("bow charm")) return false;
        String motifs = finger.path("motif").toString().toLowerCase();
        if (!motifs.contains("ribbon") && !motifs.contains("bow")) return false;
        return !java.util.regex.Pattern.compile("(?i)\\b(?:3d|raised|embossed|sculpted|charm)\\b")
                .matcher(finger.path("description").asText("")).find();
    }

    private boolean isPaintedFlowerNail(JsonNode finger) {
        if (fingerHasFinish(finger, "sculpted 3d")) return false;
        // 잉크 드로잉 손톱의 꽃은 "번진 깨알 블롯"이 아니라 색연필로 그린 손그림 꽃이다(잉크 블록에서 따로 지시한다).
        if (fingerHasFinish(finger, "ink")) return false;
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

    private boolean arrayHasValue(JsonNode arr, String value) {
        if (arr == null || !arr.isArray()) return false;
        for (JsonNode n : arr) if (value.equalsIgnoreCase(n.asText("").trim())) return true;
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

    private static final java.util.regex.Pattern HEX_TOKEN =
            java.util.regex.Pattern.compile("#([0-9A-Fa-f]{6})(?![0-9A-Fa-f])");

    /** 텍스트에 들어있는 "#RRGGBB" 헥스를 대문자 "#RRGGBB"로, 등장 순서대로 중복 없이 모은다. */
    private LinkedHashSet<String> extractHexes(String text) {
        LinkedHashSet<String> hexes = new LinkedHashSet<>();
        java.util.regex.Matcher m = HEX_TOKEN.matcher(text == null ? "" : text);
        while (m.find()) hexes.add("#" + m.group(1).toUpperCase());
        return hexes;
    }

    /**
     * scan-auto 플랜의 top-level color를 추천 팔레트의 헥스만으로 다시 쓴다.
     *  - 헥스가 있으면 각 헥스를 팔레트에서 가장 가까운 색으로 맞춘다 (그대로 복사했으면 자기 자신).
     *  - 헥스 없이 이름만 적었으면 팔레트 색 이름과 대조해서 고른다.
     * 아무것도 못 찾으면 플랜 값을 그대로 둔다.
     */
    private void snapPlanColorsToPalette(ObjectNode plan, List<String> palette) {
        if (palette.isEmpty()) return;
        String colorText = plan.path("color").asText("");

        LinkedHashSet<String> snapped = new LinkedHashSet<>();
        for (String hex : extractHexes(colorText)) {
            String best = null;
            double bestDist = Double.MAX_VALUE;
            for (String candidate : palette) {
                double dist = ColorNameResolver.distance(hex, candidate);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = candidate;
                }
            }
            if (best != null) snapped.add(normalizeHex(best));
        }

        if (snapped.isEmpty()) {
            String chosenNorm = colorText.toLowerCase().replaceAll("[^a-z0-9]", "");
            List<String> names;
            try {
                names = colorNameService.resolveColorNames(palette);
            } catch (Exception e) {
                names = List.of();
            }
            for (int i = 0; i < palette.size() && i < names.size(); i++) {
                String nameNorm = names.get(i) == null ? "" : names.get(i).toLowerCase().replaceAll("[^a-z0-9]", "");
                if (nameNorm.length() >= 3 && chosenNorm.contains(nameNorm)) snapped.add(normalizeHex(palette.get(i)));
            }
        }

        if (!snapped.isEmpty()) plan.put("color", String.join(", ", snapped));
    }

    /**
     * scan-auto 결과 화면에서 "추천 팔레트 중 어떤 색·무드·디자인 타입이 반영됐는지" 표시용 메타데이터.
     * 반영된 추천 컬러 = 최종 프롬프트 Overall style에 들어간 헥스(top-level color, snapPlanColorsToPalette로
     * 팔레트 값에 맞춰짐)와 같은 팔레트 색. 디자인 타입/모티프는 손톱별 finish·pattern·motif·parts 값에서 모아 보여준다.
     */
    private DesignGenerateResponseDto.ScanAutoReflection buildScanAutoReflection(HandScan handScan, JsonNode plan) {
        List<String> palette = scanRecommendedColors(handScan);

        Set<String> overallStyleHexes = extractHexes(plan.path("color").asText(""));
        List<String> used = palette.stream()
                .filter(hex -> overallStyleHexes.contains(normalizeHex(hex)))
                .toList();

        List<String> reflection = scanReflectionValues(plan);
        return DesignGenerateResponseDto.ScanAutoReflection.builder()
                .recommendedColors(palette)
                .usedColors(used)
                .shape(cleanPlanValue(plan.path("shape").asText("")))
                .mood(localizeReflection(reflection.get(0)))
                .designType(localizeReflection(reflection.get(1)))
                .motif(localizeReflection(reflection.get(2)))
                .season(localizeReflection(reflection.get(3)))
                .build();
    }

    /** scan-auto "반영된 스타일"의 원래(영어) 값 — 무드, 디자인 타입, 모티프, 계절 순 (없으면 null). */
    private List<String> scanReflectionValues(JsonNode plan) {
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
        return Arrays.asList(
                cleanPlanValue(plan.path("mood").asText("")),
                designTypes.isEmpty() ? cleanPlanValue(plan.path("designType").asText("")) : String.join(", ", designTypes),
                motifs.isEmpty() ? cleanPlanValue(plan.path("motif").asText("")) : String.join(", ", motifs),
                cleanPlanValue(plan.path("season").asText("")));
    }

    /**
     * 결과 화면 "반영된 스타일" 표시용: "glitter, chrome" 같은 플랜 값을 결과 키워드와 같은 한글 표기로 바꾼다 ("글리터, 크롬").
     * 한글로 못 바꾼 값은 뺀다(결과 키워드와 같은 규칙). 남는 게 없으면 null. 표시 전용이라 플랜/프롬프트는 건드리지 않는다.
     */
    private String localizeReflection(String value) {
        if (value == null) return null;
        List<String> parts = Arrays.stream(value.split(","))
                .map(String::trim)
                .filter(s -> !s.isBlank() && !"none".equalsIgnoreCase(s))
                .toList();
        List<String> localized = localizeKeywords(parts);
        return localized.isEmpty() ? null : String.join(", ", localized);
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

        // 다른 생성 방식(summarizeSlots)과 같은 "#HEX (이름)" 형식으로 넘겨서, top-level color(= 최종 프롬프트의
        // Overall style)엔 헥스가, 손톱별 description엔 자연어 색 이름이 들어가도록 맞춘다.
        List<String> palette = scanRecommendedColors(handScan);
        if (!palette.isEmpty()) {
            sb.append("color 후보(사용자 퍼스널컬러 분석 기반 추천 팔레트 ").append(palette.size())
                    .append("색 - 이 목록 안에서만 색을 고르고, 고른 색 앞의 헥스코드를 top-level color 필드에 그대로 복사): ")
                    .append(String.join(", ", pairHexWithNames(palette))).append("\n");
        }

        sb.append("""
                [스캔 정보 기반 자동 생성 - 매우 중요]
                - 이 요청은 사용자가 mood/designType/color/motif를 하나도 입력하지 않은 자동 생성입니다.
                - 색은 위 "color 후보" 팔레트 안에서만 고르세요. 팔레트에 없는 색을 창작하거나 추측하지 마세요.
                - 팔레트에서 서로 조화롭게 어울리는 2~4개의 색을 직접 골라 조합하세요.
                  단 한 가지 색으로만 칠한 단색(one-color) 디자인은 절대 만들지 마세요.
                - top-level color 필드에는 고른 색의 헥스코드만 팔레트에 적힌 그대로 쉼표로 구분해 적으세요
                  (예: "#E8B4C0, #F5E1D3"). 괄호 안의 색 이름은 넣지 마세요.
                - 손톱별 description에는 헥스코드 대신 괄호 안 이름을 참고한 자연스러운 영어 색 이름을 쓰세요.
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
        boolean elegantCheckRef = referenceFinishes.contains(FinishReferenceService.ELEGANT_CHECK);
        boolean funkyMood = plan.path("mood").toString().toLowerCase().contains("funky");
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

        sb.append("Create a realistic close-up product photograph of exactly five individual")
                .append("press-on nail tips, arranged as one coordinated nail-art set.\n\n");

        // ★ 파우더 레퍼런스(흑백 사진)가 첨부된 경우: 광택만 가져오고 색/무늬/모양은 복사하지 않도록 역할을 제한한다.
        if (powderRef) {
            // ★ "은은하고 고른 광택"으로만 적으면 레퍼런스가 있어도 납작한 새틴처럼 나왔다 - 레퍼런스의 핵심은 두껍고
            // 젖은 듯한 유리 광택과 진주빛으로 번지는 밝은 하이라이트다. 그 "빛 표현"을 목표로 삼되, 줄무늬/색/모양은
            // 계속 복사하지 못하게 막는다(색과 무늬는 손톱별 설명만 따른다).
            sb.append("Reference image: the attached grayscale photo shows how a real pearl-powder finish catches ")
                    .append("light — a thick, wet, glass-like gloss with a luminous mother-of-pearl glow, bright creamy ")
                    .append("highlights and soft reflected light gliding over the curve of the nail, so the surface has ")
                    .append("real depth. Reproduce that luminous, wet, light-catching pearl gloss on the nails whose ")
                    .append("description mentions a powder finish: the sheen must be clearly visible and glossy, never ")
                    .append("matte, flat satin or chalky. Take only this gloss and the way light plays on it. Do NOT copy ")
                    .append("the reference's streaks, swirls, veins, cloudy patches, or texture pattern, nor its nail ")
                    .append("shape, angle, background, arrangement, or tones; colors, patterns and decorations come only ")
                    .append("from the nail descriptions below.\n\n");
        }

        // ★ 우아한 체크 레퍼런스(흑백 사진 1장): 체크 패턴의 성격(반투명 대각선 띠와 얇은 선)과 절제된 우아함만 가져오고
        // 색/리본/큐빅/진주/글리터 그라데이션/네일 모양/두 줄 배치/배경은 복사하지 않는다.
        if (elegantCheckRef) {
            sb.append("Reference image (elegant check): the attached grayscale photo shows the character of an elegant check ")
                    .append("on real nails — translucent diagonal argyle-style bands crossing each other with thin fine lines ")
                    .append("tracing them, on a sheer glossy base, with a refined, understated, luxurious mood. Use it ONLY as a ")
                    .append("style reference for the nails whose description mentions a check: the translucent diagonal crossing ")
                    .append("bands, the thin fine lines, and the elegant restraint. Do NOT copy its colors, bows, rhinestones, ")
                    .append("pearls, glitter ombré, nail shape, two-row arrangement, plate, or background; colors, decorations, ")
                    .append("and layout come only from the nail descriptions below, and the check lines carry no glitter unless ")
                    .append("a description says so.\n\n");
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
        // ★ 쉐입(스퀘어 등)은 "끝(프리엣지)" 모양만 정한다. 이 구분이 없으면 이미지 모델이 큐티클 쪽 위 모서리까지
        // 각지게 그려서, 큐티클은 항상 부드러운 둥근 곡선이 되도록 명시한다.
        sb.append(" The nail shape describes ONLY the free edge at the bottom of each nail. The cuticle end at the top")
                .append(" of every nail is always a soft, rounded arc, whatever the shape is - never squared off,")
                .append(" flattened or pointed.");
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
                    if (!mv.isBlank() && !mv.contains("flower") && !mv.equals("none")
                            && !mv.contains("dot") && !mv.contains("plaid") && !mv.contains("check") && !mv.contains("gingham")) {
                        hasFlatMotif = true;
                    }
                }
                boolean isRaisedOrSoft = java.util.regex.Pattern
                        .compile("(?i)3d|raised|embossed|sculpted|charm|bead|watercolor|blot|bleed|blooming")
                        .matcher(fingerDescription).find();
                // ★ 리본은 낙서 말고도 가는 선 스케치 / 미니 리본 트림 / 리본 레이스업처럼 섬세한 평면 표현이 흔하다.
                // 플래너가 그렇게 쓴 손톱(설명에 fine line-art, mini bows, ribbon lacing 등)에 "유치한 낙서" 문장을 붙이면
                // 모든 리본이 같은 낙서처럼 나오므로, 그런 손톱에는 섬세한 선화 문장을 대신 붙인다.
                boolean isFineLineArt = !isDoodle && java.util.regex.Pattern
                        .compile("(?i)fine\\s+line[- ]?art|line[- ]?art\\s+(?:bow|ribbon)|mini\\s+bows?|ribbon\\s+lacing|ribbon[- ]band|sketch")
                        .matcher(fingerDescription).find();
                // ★ 잉크 드로잉 손톱은 아래 잉크 블록의 "잉크 덩어리 + 색연필" 문장이 그림 표현을 정하므로 낙서/선화 문장은 붙이지 않는다.
                boolean inkNail = fingerHasFinish(finger, "ink");
                // ★ 도트 손톱: 도트 패턴이거나, 도트가 모티프로 들어왔거나, 프렌치 팁 띠에 도트가 있다고 쓴 손톱.
                boolean dotNail = arrayHasValue(finger.path("pattern"), "polka dot")
                        || finger.path("motif").toString().toLowerCase().contains("dot")
                        || (arrayHasValue(finger.path("pattern"), "french tip")
                        && java.util.regex.Pattern.compile("(?i)\\bdots?\\b|polka").matcher(fingerDescription).find());
                // ★ 손으로 그은 체크: 체크 손톱(글리터 체크 제외)의 설명에 wobbly / hand-drawn 선이 있으면 삐뚤빼뚤한 선 문장을 붙인다.
                boolean handCheckNail = arrayHasValue(finger.path("pattern"), "plaid")
                        && java.util.regex.Pattern.compile("(?i)wobbl|hand-?drawn[^.]*lines?").matcher(fingerDescription).find();
                // ★ 드로잉 리본은 리본 스티커 같은 또렷한 선화 한 가지로 고정한다(낙서/흐릿한 색연필/젤펜 변형 없이).
                boolean ribbonDrawing = isDrawnRibbonNail(finger);
                if (ribbonDrawing) {
                    nailsSection.append(" The ribbon is a simple, delicate hand-drawn line-art bow with two loops, a small knot, and two")
                            .append(" flowing tails (the tails may cross or curl), drawn with a thin, even, light line. " + (inkNail
                                    ? "The bow's loops, knot, and tails are filled with transparent ink color. "
                                    : "The loops are empty, not filled. ") + "The line color is the color stated in the")
                            .append(" description above, or a slightly deeper tone of the ribbon's own color if none is stated; it is")
                            .append(" never a heavy, dark, or black outline.");
                } else if (inkNail || dotNail) {
                    // 잉크/도트 손톱은 아래 전용 블록에서 처리한다(낙서/선화 문장은 붙이지 않는다).
                } else if (isFineLineArt && hasFlatMotif && !isSpiralNail && !isRaisedOrSoft) {
                    nailsSection.append(" The drawing is a delicate fine line-art illustration: thin, evenly colored")
                            .append(" gel-pen lines with clean edges and graceful, balanced proportions (not a naive doodle),")
                            .append(" in the exact colors stated above, and any sheer color wash stays soft and inside the")
                            .append(" lines. It never looks like a sticker, decal, or printed clip-art. If the drawing is a")
                            .append(" named character, keep that character's official signature colors and markings exactly")
                            .append(" as described.");
                } else if (isDoodle || (hasFlatMotif && !isSpiralNail && !isRaisedOrSoft)) {
                    nailsSection.append(" The drawing is a naive childlike doodle: a simple outline with slightly")
                            .append(" imperfect proportions, but the line itself is perfectly smooth — a solid,")
                            .append(" evenly colored, evenly glossy stroke like a smooth gel pen, with no grain, no")
                            .append(" bumps, no lumps, and no fuzzy pencil texture. It never looks like a sticker,")
                            .append(" decal, or printed clip-art. If the drawing is a named character, only the line")
                            .append(" quality is naive: keep that character's official signature colors and markings")
                            .append(" exactly as described (never recolor it to gray, black, or a generic animal).");
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
                // ★ 도트: 손톱 전체를 차지하는 단독 디자인이거나 프렌치 팁 영역에만 들어간다(다른 요소 주변에 뿌리지 않는다).
                if (dotNail) {
                    // ★ 도트는 외곽선 없는 단순한 솔리드 도트다. 손톱 전체를 채우거나 프렌치 팁 띠 안에만 들어간다(군집/한쪽 흩뿌림 금지).
                    if (java.util.regex.Pattern.compile("(?i)french").matcher(fingerDescription).find()
                            || arrayHasValue(finger.path("pattern"), "french tip")) {
                        nailsSection.append(" The dots sit only inside the french tip band at the free edge, evenly spaced in a row or a")
                                .append(" staggered pair of rows; the rest of the nail has no dots.");
                    } else {
                        nailsSection.append(" The dots are the whole design: evenly spaced round dots of one size in a regular staggered")
                                .append(" grid covering the entire nail from cuticle to tip, with nothing else on the nail.");
                    }
                    nailsSection.append(" Each dot is a simple solid filled round dot with no outline (never an outlined cartoon circle);")
                            .append(" this overrides any cluster, side scatter, or outlined dots described above.");
                    if (fingerHasFinish(finger, "ink")) {
                        nailsSection.append(" The dots are made of sheer, saturated transparent ink color, like glass dots over the base color.");
                    }
                }
                if (arrayHasValue(finger.path("pattern"), "blooming")
                        || java.util.regex.Pattern.compile("(?i)\\bblooming\\b").matcher(fingerDescription).find()) {
                    // ★ 블루밍: 잉크 한 방울이 젖은 젤에 번진 듯한 "속이 찬" 큰 점들이 손톱 외곽선(프리엣지/옆면)을 따라 이어진다.
                    nailsSection.append(" The blooming look is made of large soft round dots, each a FILLED blob of ink pigment like a drop")
                            .append(" of ink spreading in wet gel on the sheer glossy base: the center of every dot is its darkest, most")
                            .append(" saturated part and the color fades smoothly outward into a blurred, feathered edge. The dots are")
                            .append(" big (each about one fifth to one quarter of the nail width) and follow the outline of the nail: a")
                            .append(" row of dots along the curved free edge like a scalloped border or along one side wall, touching or")
                            .append(" overlapping so they melt into a soft scalloped edge, or a small cluster of four dots forming a")
                            .append(" blossom near a corner or the tip; never an S-curve or a chain across the middle. The dots are")
                            .append(" never rings, donuts, hollow or outlined circles, or white fluffy puffs; they are one hue, always a")
                            .append(" deeper and more saturated tone than the base (never white), with most of the base left clean and no")
                            .append(" outlines or crisp edges.");
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
                if (handCheckNail) {
                    nailsSection.append(" The check is hand-drawn: soft translucent color bands in two directions with thin, slightly")
                            .append(" wobbly hand-drawn lines running along and across the bands in an accent color (a deeper or contrasting")
                            .append(" tone), not perfectly straight, with uneven spacing and a few lines slightly overlapping or doubled,")
                            .append(" like a pen sketched over the bands; the lines are thin and light, never a heavy black grid.");
                }
                // ★ 니트(벨벳)젤: 컬러 안에 짧은 섬유 조각이 흩어진 질감. 설명만으로는 그냥 매끈한 파스텔로 나온다.
                if (fingerHasFinish(finger, "knit")) {
                    // ★ "솜털/울 같은 불투명 컬러"라고 쓰면 니트 스웨터 직물처럼 나왔다 - 레퍼런스(뽀그리젤)는 투명한 시럽 젤 속에
                    // 가는 머리카락 같은 섬유가 떠 있는 모습이다. 직물/뜨개 질감은 명시적으로 막는다.
                    nailsSection.append(" Knit (velvet) gel: the soft glossy gel color is filled with hundreds of TINY short fiber")
                            .append(" fragments, like chopped wool or velvet flock, spread evenly over the whole nail and floating inside")
                            .append(" the clear gel. Each fragment is very short (about one thirtieth of the nail width) and thin, at")
                            .append(" random angles, in lighter and darker tones of the same hue with a few in a soft accent hue, so the")
                            .append(" nail looks like fuzzy velvet made of tiny flecks. They are never a few long thin lines, cracks,")
                            .append(" veins, or scratches. The surface stays smooth and glossy; it is not a woven or knitted fabric. No")
                            .append(" large glitter.");
                }
                // ★ 잉크젤. 모티프가 있으면 "잉크 일러스트"(또렷한 외곽선 + 투명 잉크 색 채움)고, 없으면 맑은 손톱 위의 투명 워시다.
                // (선만 있거나 워시만 있으면 잉크를 썼다고 볼 수 없다 - 참고: 외곽선 안을 잉크로 칠한 귀여운 손그림 캐릭터)
                if (fingerHasFinish(finger, "ink")) {
                    boolean inkHasMotif = false;
                    for (JsonNode mo : finger.path("motif")) {
                        String mv = mo.asText("").trim().toLowerCase();
                        if (!mv.isEmpty() && !mv.equals("none") && !mv.contains("dot") && !mv.contains("plaid")
                                && !mv.contains("check") && !mv.contains("gingham")) inkHasMotif = true;
                    }
                    if (dotNail) {
                        // 도트 손톱의 잉크 표현은 위 도트 문장에서 처리한다(일러스트/워시 문장은 붙이지 않는다).
                    } else if (inkHasMotif) {
                        nailsSection.append(" This is ink drawing art, like a cute hand-inked illustration sticker: the shapes of the")
                                .append(" motif described above are filled in with transparent ink gel colors —")
                                .append(" sheer, saturated, flat-looking color areas with slightly uneven watercolor-like density,")
                                .append(" clearly visible inside the motif, with at most a thin, light line in a slightly deeper tone of")
                                .append(" the same hue (no black or heavy dark outline). Small details inside the motif (a knot, folds,")
                                .append(" a face, stripes) use the same light line. It is drawn on top of the base color described above (not on a bare clear nail),")
                                .append(" so the ink fills look like colored glass over it. The motif is clearly recognizable and fairly large (about half of")
                                .append(" the nail). No fuzzy, hairy, feathered, or pencil-textured lines, and no abstract lines,")
                                .append(" lacing, spirals, or pearls in place of the motif.");
                        if (finger.path("motif").toString().toLowerCase().contains("flower")) {
                            nailsSection.append(" The flower is simple: about five rounded petals filled with ink color around a")
                                    .append(" small center, with a small leaf; this overrides any tiny or smudged flower wording elsewhere.");
                        }
                    } else {
                        nailsSection.append(" The ink is a vivid but fully transparent gel, like colored glass or marker ink, laid over")
                                .append(" the base color described above: it appears as clean, saturated, see-through washes —")
                                .append(" soft-edged ribbon-like or wave-like swaths with slightly deeper pooled edges, covering only")
                                .append(" part of the nail while the rest shows the base color. It is not a milky or pastel blush and")
                                .append(" not an airbrush gradient over the whole nail.");
                        if (java.util.regex.Pattern.compile("(?i)plaid|check|gingham").matcher(fingerDescription).find()) {
                            nailsSection.append(" The ink check is a gingham of wide see-through stripes of one vivid hue running in")
                                    .append(" two directions over the base color, looking deeper where they cross, with soft hand-painted")
                                    .append(handCheckNail ? " edges - not a sharp printed grid."
                                            : " edges and no dark lines between them - not a sharp printed grid.");
                        }
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
                        nailsSection.append(" The pearl-powder finish sits as a thin transparent layer over the pattern")
                                .append(" above, with the same luminous, wet-looking pearl gloss as the reference photo;")
                                .append(" the pattern itself is drawn exactly as described, not taken from the reference.");
                    } else {
                        nailsSection.append(" Surface: one even color from cuticle to tip with a luminous, wet-looking")
                                .append(" pearl-powder gloss — a bright creamy mother-of-pearl highlight gliding along the")
                                .append(" curve of the nail and soft iridescent light across the whole surface, with real")
                                .append(" glassy depth like the reference photo; the color itself stays smooth, with no")
                                .append(" streaks, swirls, marbling, veining, or cloudy patches.");
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

        // ★ 한 세트의 리본은 전부 같은 룩(같은 색/재질/형태)이어야 한다 - 손톱마다 색이 다른 리본이 나오던 문제.
        // 리본이 2개 이상의 손톱에 있으면 첫 리본 손톱의 설명을 기준으로 통일하라는 문장을 붙인다(크기/위치만 달라도 됨).
        int ribbonNails = 0;
        for (String name : fingerNames) {
            if (java.util.regex.Pattern.compile("(?i)\\b(?:bow|bows|ribbon|ribbons)\\b")
                    .matcher(plan.path(name).path("description").asText("")).find()) ribbonNails++;
        }
        if (ribbonNails >= 2) {
            sb.append("Ribbon consistency (very important): every ribbon or bow on these nails is the very same ")
                    .append("design — identical color, identical material, identical finish, and identical line ")
                    .append("style, as if cut from one mold or drawn with one pen. Follow the first ribbon described ")
                    .append("above for all of them. Only the size and position may differ from nail to nail. Never ")
                    .append("make one ribbon a different color, and never mix a drawn ribbon with a raised 3D one.\n\n");
        }

        sb.append("Composition:\n")
                .append("Arrange exactly five nail tips in a neat horizontal group, ")
                .append("similar size and proportion, each nail completely visible, no overlap, ")
                .append(useTransparentGptImage()
                        ? "centered composition, large amount of empty negative space around the nails, "
                        : "centered composition, large amount of clean white negative space, ")
                .append("tips_only_flatlay presentation.\n\n");

        // ★ 실제 젤네일은 컬러/아트 위에 투명 탑젤을 두껍게 올려 큐어링해서 손톱 전체가 볼록한 유리 돔처럼 된다.
        // "glossy"라고만 쓰면 모델이 납작한 페인트판 + 얇은 하이라이트로 그려서 광택이 죽었다 -
        // 두께감, 가장자리에 맺힌 젤, 길게 뻗는 창문형 하이라이트, 아트가 젤 아래에 잠긴 깊이를 구체적으로 지정한다.
        if (!surface.toLowerCase().contains("matte")) {
            sb.append("Glossy gel overlay (very important): every nail not described as matte is finished the way a ")
                    .append("real salon gel manicure is — one or two thick layers of clear top gel are cured over the ")
                    .append("color and the art, so the whole nail becomes a plump, convex, glass-like dome instead of a ")
                    .append("flat painted plate. Show it clearly: the gel has visible thickness, gathers into a soft ")
                    .append("rounded bead along the cuticle, the side walls, and the free edge, and swells smoothly over ")
                    .append("the curve of the nail. The dome catches the softbox as one long, bright, soft-edged ")
                    .append("window-shaped highlight running down the length of the nail, with a thin crisp rim of ")
                    .append("reflected light along one edge, and the color and any flat art underneath look slightly ")
                    .append("magnified and sunk beneath the clear glassy layer, with the wet depth of a drop of syrup. ")
                    .append("The shine is juicy and liquid, never a flat sticker-like surface, never dull satin, never ")
                    .append("hard plastic. This dome is only a surface treatment: it never changes the nail's color, ")
                    .append("adds no glitter, and creates no new decoration.\n\n");
        }

        // ★ 결과가 "AI/CGI 티"(과하게 크고 플라스틱 같은 파츠, 납작한 채도 높은 단색, 디지털 그라데이션)로 나왔다.
        // 실제 샵 포트폴리오는 파츠/모티프가 작고 절제되며 색이 투명하고 채도가 낮다 - 그 기준을 명시한다.
        // ★ 펑키 무드는 파츠가 많고 화려한 것이 기본이다 - "작고 절제된" 현실감 문단 대신 화려한 버전을 쓴다.
        if (funkyMood) {
            sb.append("Funky nail-art (very important): this is a bold, flashy, richly decorated press-on set from a Korean nail ")
                    .append("salon's portfolio, photographed as a real product. Charms, pearls, rhinestones, chains, and studs are ")
                    .append("layered and clustered on most nails, and glossy, chrome, and vivid or high-contrast colors are welcome. ")
                    .append("Every piece is a real, physically plausible, hand-set resin, metal, or glass object with visible ")
                    .append("thickness and natural highlights, never a plastic toy or a game asset, and the arrangement stays tidy ")
                    .append("and clearly readable instead of overlapping into a mess.\n\n");
        }
        if (!funkyMood) sb.append("Real nail-art realism (very important): this must look like a photo of a real hand-made press-on ")
                .append("set from a Korean nail salon's portfolio, not an AI render. Real sets are restrained and ")
                .append("delicate: charms, pearls, and motifs are SMALL (one charm covers at most about a quarter of ")
                .append("the nail) and sit off-center, leaving most of the nail as a bare sheer milky base. Colors are ")
                .append("soft, translucent, and slightly desaturated, never flat saturated candy pigment, and a ")
                .append("gradient is a soft translucent blend of gel rather than a digital two-color fade. Resin or ")
                .append("acrylic charms are small, milky or pearly with slightly irregular hand-molded edges, set into ")
                .append("a small bead of clear gel that blends them into the nail; metal charms are tiny and polished; ")
                .append("pearls are small round beads; rhinestones are tiny; hand-drawn lines are thin and slightly ")
                .append("imperfect like real fine-brush or gel-pen strokes. Nothing looks like a plastic toy, a game ")
                .append("asset, a sticker, or an oversized decoration.\n\n");

        sb.append("Photography:\n")
                .append("Shot as a real macro product photograph on a professional camera ")
                .append("(Canon EOS R5, 100mm f/2.8 macro lens), the kind of photo a Korean nail ")
                .append("artist posts on Instagram or Pinterest to sell a press-on set — not a 3D ")
                .append("render, not CGI, not a digital illustration, not flat vector art, not clip ")
                .append("art, not a cartoon or plastic-toy look, not a smooth game-asset render.\n\n")
                .append("Lighting: a soft studio softbox at a low angle wraps gently around the curved ")
                .append("surface of each nail with soft bounce fill in the shadows — the exact highlight ")
                .append("shape (a long, bright, window-shaped glassy highlight along the gel dome for glossy/chrome/jelly finishes, or a luminous, wet-looking ")
                .append("pearly sheen over the whole nail with bright soft reflections gliding along the curve for ")
                .append("powder finishes, ")
                .append("without changing the nail's color) ")
                .append("should follow whatever each nail's own material description above specifies, ")
                .append("rendered with real-photo specular realism. Where the nail is jelly, milky, or ")
                .append("translucent, render real light transmission — light glows softly from within ")
                .append(useTransparentGptImage()
                        // 투명 PNG로 받을 때 "배경이 비친다"고 쓰면 모델이 손톱의 흰/맑은 부분을 알파 0으로 뚫어버려
                        // 손톱 끝이 잘린 채 나온다(AR 크롭에서 흰 그라데이션 끝이 사라지던 원인). 손톱 몸통은 알파가 꽉 차야 한다.
                        ? "the clear gel, like real gel catching light. The silhouette of every nail stays fully "
                        + "solid from cuticle to free edge — no part of a nail may be transparent, "
                        + "semi-transparent, or cut out. Show translucency only as glassy depth and inner "
                        + "glow inside the nail, and render any white, milky, or clear-looking part (for "
                        + "example a gradient that fades to white at the tip) as solid milky white.\n\n"
                        : "the clear gel and the white background is faintly visible through the "
                        + "translucent edges, like real gel catching light, never a flat opaque pastel "
                        + "coating.\n\n")
                .append(useTransparentGptImage()
                        // 투명 PNG에서는 그림자가 반투명 회색 픽셀로 남아 AR 크롭에 섞이므로 그림자를 요구하지 않는다.
                        ? "Isolated cut-out on a fully transparent background — no backdrop, floor, or white or colored "
                        + "fill behind the nails — and no cast shadow, drop shadow, or reflection under or beside the nails, "
                        : "Clean seamless white background, soft gentle shadow beneath each nail, ")
                .append("shallow depth of field with tack-sharp macro focus on the nail surfaces, ")
                .append("true-to-life color rendering. Only tiny natural imperfections of real handmade ")
                .append("gel nails (a slightly uneven edge or cuticle line); the color layer itself is smooth and ")
                .append("even with no texture, grain, crackle, grid, or surface pattern of its own (except the knit fibers or ink check that a nail's own description specifies), and the clear top gel stays smooth, thick, and glossy. ")
                .append("The five nails are one matched set cured from the same bottle: the base color, ")
                .append("tone, translucency, and gloss level are exactly the same on every nail, with no ")
                .append("nail looking pinker, grayer, bluer, lighter, or more transparent than the others — ")
                .append("only designs that a nail's own description assigns to it may differ. Unless the design explicitly ")
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
            // ★ 쉐입을 "rounded proportions" 정도로만 쓰면 라운드가 오발(달걀형)로 나왔다. 윤곽을 구체적으로 지정한다.
            // (스퀘어/발레리나의 "끝(프리엣지)만 각진다"는 팀원 수정 의도는 유지: 큐티클은 항상 둥근 곡선이다.)
            case "stiletto"  -> " with a long outline whose sides taper evenly into a sharp, narrow point";
            case "almond"    -> " with a slightly elongated outline whose sides taper gently to a softly pointed, rounded tip";
            case "ballerina" -> " with a long outline whose sides taper inward and end in a flat, narrower free edge with squared corners";
            case "oval"      -> " with a gently tapered egg-shaped outline, narrower toward a fully curved free edge";
            case "square"   -> " with straight parallel side walls and a free edge that is flat and straight across with softly squared corners";
            case "round"    -> " with a short-to-medium, wide outline: nearly parallel straight side walls and a broad, softly"
                    + " rounded free edge, like a rounded rectangle or a square whose corners are generously rounded (the"
                    + " nail is wide, about two thirds as wide as it is long, and keeps its width all the way to the tip),"
                    + " not a narrow tapered oval or egg shape";
            default -> "";
        };
    }

    private String buildMaterialSection(String surface, List<String> finishes, List<String> parts) {
        List<String> items = new ArrayList<>();
        boolean isMatte = surface.toLowerCase().contains("matte");
        items.add(isMatte ? "matte finish"
                : "glossy gel polish under a thick clear top-gel overlay that forms a plump convex glass-like dome");
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
        if (finishLower.contains("glitter"))        items.add("fine sparkle on the nails described with glitter — only small bright twinkling points of " +
                "light scattered loosely over a perfectly smooth, clean, evenly colored glossy surface, in the nail's own " +
                "hue family (soft pink, rose, silver, or champagne). The sparkle adds no texture and no pattern: the color " +
                "underneath stays one flat smooth tone with nothing drawn or printed on it, and the gel is clear and " +
                "smooth. No large flakes, chunks, or confetti");
        if (finishLower.contains("chrome"))         items.add("metallic chrome sheen");
        // ★ 자석젤은 유리알 광택이 기본(입자 없음) — 글리터와 구분한다.
        if (finishLower.contains("magnetic cat eye"))
            items.add("round glass-bead magnetic gel glow on the nails described as magnetic — a soft domed pearly " +
                    "gleam gathered in the center of the nail with a bright clean highlight, in silver or " +
                    "champagne gold only, never a stripe or swirl, with no visible particles or sparkle");
        if (finishLower.contains("foil"))           items.add("metallic foil accents");
        if (java.util.regex.Pattern.compile("\\bknit\\b").matcher(finishLower).find())
            items.add("knit (velvet) gel on the nails described as knit — soft glossy gel color densely filled with hundreds " +
                    "of tiny short fiber fragments (chopped wool / velvet flock) at random angles floating inside the gel, smooth " +
                    "glossy top coat, not long lines or cracks and not a woven fabric look");
        if (java.util.regex.Pattern.compile("\\bink\\b").matcher(finishLower).find())
            items.add("ink gel on the nails described as ink — vivid but fully transparent ink color like colored glass or " +
                    "marker ink, used as drawing fills, washes, or checks on top of the base color, juicy glossy dome");
        // ★ "iridescent powder shimmer"였을 때 이미지 모델이 "shimmer"를 잔글리터로 해석해서
        // 매끈한 크롬 파우더 대신 반짝이 가루처럼 나오던 문제 — glitter를 명시적으로 금지.
        if (finishLower.contains("powder finish"))
            // ★ 목표 레퍼런스는 "오로라 펄 파우더": 손톱 중앙을 따라 가늘고 밝은 진주빛 흰 띠(거울 반사)가
            // 선명하게 뻗고, 양옆으로 핑크/라일락 펄 그라데이션이 번지는 실제 사진 같은 광택.
            // 부드러운 헤이즈 버전은 새틴처럼 납작하게 나와서 "파우더 느낌이 별로"였음.
            // ★ 부정문을 길게 나열하면 이미지 모델이 오히려 그 개념(자석젤/글리터)을 떠올림 —
            // 짧은 긍정문 위주로 쓰고 글리터 금지만 한 번 명시한다.
            // ★ "smooth, even ... sheen"만 쓰면 광택이 은은하게 죽어서 새틴처럼 납작했다 - 살아 있는 하이라이트를 명시한다.
            items.add("full-cover pearlescent powder finish with a luminous, wet-looking mother-of-pearl gloss — a " +
                    "bright creamy pearl highlight gliding along the curve of the nail and soft iridescent light " +
                    "across the whole surface in the nail's own color (never tinting the base color), sealed under " +
                    "a thick glass-like glossy top coat with real depth, no glitter specks");
        if (finishLower.contains("sculpted 3d") || partsLower.contains("charm"))
            items.add("realistic sculpted 3d decorations, dimensional charms with smooth plump glossy surfaces and no ribs, stripes, or line patterns on bow loops or petals");
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

    private static final int MAX_PLAN_KEYWORDS = 8;
    private static final int MAX_TOTAL_KEYWORDS = 12;
    // finish/pattern은 이만큼 이상의 손가락에서 쓰였을 때만 키워드로 (한 손가락에만 쓴 보조 디테일은 제외).
    // motif/parts(눈에 띄는 장식)는 한 손가락이어도 포함한다.
    private static final int MIN_STYLE_COUNT = 2;
    // 키워드 비교용: 의미 없이 붙는 일반 단어는 빼고 비교한다 ("snowman art" == "snowman")
    private static final Set<String> GENERIC_KEYWORD_WORDS = Set.of(
            "art", "charm", "charms", "pattern", "finish", "design", "motif", "decor", "decoration",
            "drawing", "painting", "print", "tip", "tips", "nail", "nails", "style", "look", "effect", "mascot", "bead", "beads", "trim", "shape", "shapes");
    // 디자인 정보가 없는 막연한 말은 키워드로 보여주지 않는다 (예: "trendy"). 화면에 보이면 한 줄씩 추가.
    private static final Set<String> VAGUE_KEYWORDS = Set.of(
            "trendy", "nice", "beautiful", "pretty", "stylish", "premium", "luxury",
            "fashionable", "popular", "aesthetic");
    // 같은 뜻의 단어는 하나로 본다 ("plaid" == "check pattern")
    private static final Map<String, String> KEYWORD_SYNONYMS = Map.of(
            "plaid", "check", "tartan", "check", "gingham", "check", "checkered", "check", "checks", "check",
            "flower", "floral");

    /**
     * 디자인 플랜(5개 손가락)에 실제로 쓰인 finish/pattern/motif/parts 값을 키워드로 뽑는다.
     * 사진 기반 생성은 슬롯(mood/shape 등)이 거의 비어 있어서 키워드가 3개 안팎으로만 나오던 문제 보완.
     * 여러 손가락에서 많이 쓰인 값을 먼저, 최대 MAX_PLAN_KEYWORDS개.
     */
    /**
     * 참고 사진이 뚜렷한 작품/캐릭터/브랜드(예: "나루토")일 때 플랜의 reference_subject(한글 이름)를 맨 앞 키워드로 쓴다.
     * 화면 표시 전용 라벨이라 이미지 프롬프트에는 들어가지 않는다. 비어 있거나 너무 길면 쓰지 않는다.
     */
    private static final List<String> APP_SHAPES =
            List.of("round", "oval", "almond", "stiletto", "ballerina", "square");

    /** 임의의 쉐입 표기를 앱의 6가지 중 하나로 대응시킨다. 대응할 수 없으면 null. ("rounded square" -> square, "coffin" -> ballerina) */
    private String mapToAppShape(String raw) {
        if (raw == null) return null;
        String s = raw.trim().toLowerCase();
        if (s.isEmpty()) return null;
        if (s.contains("stiletto") || s.contains("pointed") || s.contains("sharp")) return "stiletto";
        if (s.contains("ballerina") || s.contains("coffin")) return "ballerina";
        if (s.contains("almond")) return "almond";
        if (s.contains("squoval") || s.contains("oval")) return "oval";
        if (s.contains("square")) return "square";
        if (s.contains("round")) return "round";
        return null;
    }

    /**
     * plan.shape를 앱의 6가지 쉐입 중 하나로 고정한다. 우선순위: 사용자가 고른 쉐입(슬롯) > 플랜이 적은 값을 대응시킨 것 >
     * 스캔 추천 쉐입 > oval.
     */
    private void enforceAppShape(JsonNode plan, List<String> slotShapes, String scanShape) {
        if (plan == null || !plan.isObject()) return;
        String chosen = null;
        for (String s : slotShapes) {
            chosen = mapToAppShape(s);
            if (chosen != null) break;
        }
        if (chosen == null) chosen = mapToAppShape(plan.path("shape").asText(""));
        if (chosen == null) chosen = mapToAppShape(scanShape);
        if (chosen == null) chosen = "oval";
        String current = plan.path("shape").asText("");
        if (!chosen.equals(current)) {
            System.out.println("[NailDesignService] plan.shape 보정: '" + current + "' -> '" + chosen + "'");
        }
        ((ObjectNode) plan).put("shape", chosen);
    }

    private List<String> referenceSubjectKeyword(JsonNode plan) {
        if (plan == null || !plan.isObject()) return List.of();
        String subject = plan.path("reference_subject").asText("").trim();
        if (subject.isEmpty() || subject.length() > 20 || "none".equalsIgnoreCase(subject)) return List.of();
        return List.of(subject);
    }

    private List<String> extractPlanKeywords(JsonNode plan) {
        if (plan == null || !plan.isObject()) return List.of();
        Map<String, Integer> counts = new LinkedHashMap<>();
        Set<String> decorations = new HashSet<>(); // motif/parts에서 나온 키워드
        for (String finger : List.of("thumb", "index", "middle", "ring", "pinky")) {
            JsonNode f = plan.path(finger);
            if (!f.isObject()) continue;
            for (String field : List.of("finish", "pattern", "motif", "parts")) {
                for (String v : toTextList(f.path(field))) {
                    String key = v.trim().toLowerCase();
                    if (key.isBlank() || "none".equals(key) || "상관없음".equals(key)) continue;
                    counts.merge(key, 1, Integer::sum);
                    if (field.equals("motif") || field.equals("parts")) decorations.add(key);
                }
            }
        }
        return counts.entrySet().stream()
                .filter(e -> decorations.contains(e.getKey()) || e.getValue() >= MIN_STYLE_COUNT)
                .sorted((x, y) -> y.getValue() - x.getValue()) // 안정 정렬: 동률이면 등장 순서 유지
                .limit(MAX_PLAN_KEYWORDS)
                .map(Map.Entry::getKey)
                .toList();
    }

    /** 키워드 중복 비교용 정규형: 소문자, 일반 단어 제거, 동의어 통일. 비면 원문 소문자. */
    private String keywordCore(String k) {
        List<String> words = new ArrayList<>();
        for (String w : k.trim().toLowerCase().split("[\\s_-]+")) {
            if (w.isBlank() || GENERIC_KEYWORD_WORDS.contains(w)) continue;
            words.add(KEYWORD_SYNONYMS.getOrDefault(w, w));
        }
        return words.isEmpty() ? k.trim().toLowerCase() : String.join(" ", words);
    }

    /** 슬롯 키워드 뒤에 플랜 키워드를 붙이되, 같은 뜻(snowman / snowman art, check pattern / plaid)은 먼저 나온 것만 남기고 전체 MAX_TOTAL_KEYWORDS개까지만. */
    private List<String> mergeKeywords(List<String> primary, List<String> extra) {
        Set<String> seen = new HashSet<>();
        List<String> out = new ArrayList<>();
        for (List<String> list : List.of(primary, extra)) {
            for (String k : list) {
                if (k == null || k.isBlank()) continue;
                if (VAGUE_KEYWORDS.contains(k.trim().toLowerCase())) continue;
                if (seen.add(keywordCore(k)) && out.size() < MAX_TOTAL_KEYWORDS) out.add(k.trim());
            }
        }
        return out;
    }

    // ── 키워드 한글화 ─────────────────────────────────────────────────────────
    // 결과 화면 키워드 칩은 영어 값(슬롯/플랜의 통제 어휘)이므로, 마지막 단계에서 한글로 바꾼다.
    // 중복 제거(keywordCore)는 영어 기준으로 먼저 끝난 뒤에 적용한다.
    // 사전에 없는 단어가 하나라도 있으면 그 키워드는 사전으로 옮기지 않고(엉뚱한 조합보다 낫다) 통째로
    // KeywordTranslationService에 맡긴다 — DB(keyword_translations)에 저장된 번역, 없으면 GPT로 한 번 번역해 저장한다.
    // 자주 나오는 말은 KO_WORDS(단어) 또는 KO_PHRASES(문구 전체)에 넣어 두면 DB·GPT를 거치지 않는다.
    private static final Map<String, String> KO_PHRASES = Map.ofEntries(
            Map.entry("warm and cozy", "따뜻/포근"),
            Map.entry("french tip", "프렌치"),
            Map.entry("check pattern", "체크"),
            Map.entry("powder finish", "파우더"),
            Map.entry("magnetic cat eye", "마그네틱"),
            Map.entry("cheek blush", "치크"),
            Map.entry("sculpted 3d", "3D"),
            Map.entry("polka dot", "도트"),
            Map.entry("line art", "라인 아트"),
            Map.entry("color block", "컬러 블록"),
            Map.entry("bow ribbon", "리본"),
            Map.entry("bow charm 3d", "리본"),
            Map.entry("rose gold", "로즈 골드"));

    private static final Map<String, String> KO_WORDS = Map.ofEntries(
            // 무드
            Map.entry("lovely", "러블리"), Map.entry("simple", "심플"), Map.entry("modern", "모던"),
            Map.entry("chic", "시크"), Map.entry("cute", "큐트"), Map.entry("kitsch", "키치"),
            Map.entry("funky", "펑키"), Map.entry("feminine", "페미닌"), Map.entry("elegant", "우아"),
            Map.entry("pure", "순수"), Map.entry("delicate", "섬세"), Map.entry("glamorous", "화려"),
            Map.entry("glam", "글램"), Map.entry("romantic", "로맨틱"), Map.entry("soft", "소프트"),
            Map.entry("minimal", "미니멀"), Map.entry("natural", "내추럴"), Map.entry("vintage", "빈티지"),
            Map.entry("dark", "다크"), Map.entry("playful", "유쾌함"),
            Map.entry("sweet", "스위트"), Map.entry("sophisticated", "세련된"), Map.entry("cool", "쿨"),
            Map.entry("y2k", "Y2K"), Map.entry("cozy", "포근한"), Map.entry("warm", "따뜻한"),
            Map.entry("dreamy", "몽환적"), Map.entry("pastel", "파스텔"),
            Map.entry("anime", "애니"), Map.entry("oriental", "오리엔탈"), Map.entry("innocent", "청순"),
            // 디자인/마감/패턴
            Map.entry("glitter", "글리터"), Map.entry("gradient", "그라데이션"), Map.entry("cheek", "치크"),
            Map.entry("marble", "마블"), Map.entry("french", "프렌치"), Map.entry("magnetic", "마그네틱"),
            Map.entry("powder", "파우더"), Map.entry("matte", "매트"), Map.entry("glossy", "글로시"),
            Map.entry("art", "아트"), Map.entry("chrome", "크롬"), Map.entry("jelly", "젤리"),
            Map.entry("foil", "호일"), Map.entry("syrup", "시럽"), Map.entry("plaid", "체크"),
            Map.entry("check", "체크"), Map.entry("stripe", "스트라이프"), Map.entry("lace", "레이스"),
            Map.entry("watercolor", "수채화"), Map.entry("blooming", "블루밍"), Map.entry("speckle", "스펙클"), Map.entry("line", "라인"),
            Map.entry("dot", "도트"), Map.entry("dots", "도트"), Map.entry("sparkle", "스파클"),
            // 모티프/파츠
            Map.entry("star", "별"), Map.entry("ribbon", "리본"), Map.entry("bow", "리본"),
            Map.entry("floral", "플로럴"), Map.entry("flower", "플라워"), Map.entry("heart", "하트"),
            Map.entry("crystal", "크리스탈"), Map.entry("pearl", "진주"), Map.entry("swirl", "소용돌이"),
            Map.entry("butterfly", "나비"), Map.entry("cross", "십자가"), Map.entry("bunny", "토끼"),
            Map.entry("leaf", "잎"), Map.entry("shell", "조개"), Map.entry("character", "캐릭터"),
            Map.entry("lettering", "레터링"), Map.entry("rhinestone", "큐빅"), Map.entry("bead", "비즈"),
            Map.entry("charm", "참"), Map.entry("metal", "메탈"),
            Map.entry("stud", "스터드"), Map.entry("chain", "체인"), Map.entry("cluster", "클러스터"),
            Map.entry("snowman", "눈사람"), Map.entry("spider", "거미"), Map.entry("web", "거미줄"),
            Map.entry("cobweb", "거미줄"), Map.entry("tip", "팁"), Map.entry("3d", "3D"),
            // 쉐입/길이
            Map.entry("round", "라운드"), Map.entry("oval", "오발"), Map.entry("almond", "아몬드"),
            Map.entry("stiletto", "스틸레토"), Map.entry("ballerina", "발레리나"), Map.entry("coffin", "발레리나"),
            Map.entry("square", "스퀘어"), Map.entry("short", "숏"), Map.entry("medium", "미디엄"),
            Map.entry("long", "롱"),
            // 계절
            Map.entry("spring", "봄"), Map.entry("summer", "여름"), Map.entry("autumn", "가을"),
            Map.entry("fall", "가을"), Map.entry("winter", "겨울"),
            Map.entry("christmas", "크리스마스"), Map.entry("halloween", "할로윈"),
            Map.entry("wedding", "웨딩"), Map.entry("vacation", "바캉스"),
            // 색 (ColorNameService 이름 + 수식어)
            Map.entry("white", "화이트"), Map.entry("black", "블랙"), Map.entry("red", "레드"),
            Map.entry("blue", "블루"), Map.entry("green", "그린"), Map.entry("yellow", "옐로"),
            Map.entry("orange", "오렌지"), Map.entry("pink", "핑크"), Map.entry("purple", "퍼플"),
            Map.entry("brown", "브라운"), Map.entry("gray", "그레이"), Map.entry("grey", "그레이"),
            Map.entry("beige", "베이지"), Map.entry("ivory", "아이보리"), Map.entry("cream", "크림"),
            Map.entry("navy", "네이비"), Map.entry("teal", "청록"), Map.entry("mint", "민트"),
            Map.entry("peach", "피치"), Map.entry("coral", "코랄"), Map.entry("rose", "로즈"),
            Map.entry("lavender", "라벤더"), Map.entry("olive", "올리브"), Map.entry("gold", "골드"),
            Map.entry("silver", "실버"), Map.entry("magenta", "마젠타"), Map.entry("burgundy", "버건디"),
            Map.entry("nude", "누드"), Map.entry("clear", "클리어"), Map.entry("deep", "딥"),
            Map.entry("light", "라이트"), Map.entry("pale", "페일"), Map.entry("muted", "뮤트"),
            Map.entry("vivid", "비비드"), Map.entry("dusty", "애쉬"), Map.entry("milky", "밀키"),
            Map.entry("knit", "니트"), Map.entry("ink", "잉크"));

    // 한글로 옮길 때 뜻이 없어 빼는 단어 ("star motif" -> "별")
    private static final Set<String> KO_DROP_WORDS = Set.of("motif", "finish", "pattern", "design", "mascot", "trim", "shape", "shapes");

    /** 키워드 하나를 한글로. 사전에 없는 단어가 있거나 이미 한글이면 원문 그대로. */
    private String localizeKeyword(String keyword) {
        String k = keyword.trim();
        String lower = k.toLowerCase();
        if (lower.isEmpty()) return k;
        if (KO_PHRASES.containsKey(lower)) return KO_PHRASES.get(lower);
        List<String> out = new ArrayList<>();
        for (String w : lower.split("[\\s_-]+")) {
            if (w.isBlank() || KO_DROP_WORDS.contains(w)) continue;
            String ko = KO_WORDS.get(w);
            if (ko == null) return k; // 모르는 단어(또는 한글) -> 원문 유지
            out.add(ko);
        }
        return out.isEmpty() ? k : String.join(" ", out);
    }

    // 한글로 바꾼 뒤에도 남아도 되는 영문 표기 ("3D", "Y2K")
    private static final java.util.regex.Pattern ALLOWED_LATIN = java.util.regex.Pattern.compile("3D|Y2K");

    // 사전으로 옮긴 뒤에도 영어가 남았는지 ("3D", "Y2K"는 영어로 둬도 된다)
    private static boolean hasLatin(String text) {
        return ALLOWED_LATIN.matcher(text).replaceAll("").matches(".*[A-Za-z].*");
    }

    /** 사전으로 한글이 안 되는 키워드 조각들 — KeywordTranslationService(저장된 번역 → GPT)에 맡길 것 */
    private List<String> unmappedKeywordParts(Collection<String> keywords) {
        List<String> parts = new ArrayList<>();
        for (String k : keywords) {
            if (k == null || k.isBlank()) continue;
            for (String part : splitJoinedKeyword(k)) {
                if ("none".equalsIgnoreCase(part.trim()) || ColorNameService.isHex(part)) continue;
                if (hasLatin(localizeKeyword(part))) parts.add(part);
            }
        }
        return parts;
    }

    /** 사전에 없는 말의 번역을 미리 시작해 둔다(기다리지 않는다) — 이미지를 만들기 전에 불러 두면 그동안 끝난다. */
    public void prefetchKeywordTranslations(Collection<String> keywords) {
        keywordTranslationService.prefetch(unmappedKeywordParts(keywords));
    }

    /** 키워드 조각 하나를 한글로: 사전 먼저, 없으면 번역 저장소(translated). 둘 다 없거나 칩으로 쓸 뜻이 없는 말이면 null */
    private String toKorean(String part, Map<String, String> translated) {
        String ko = localizeKeyword(part);
        if (!hasLatin(ko)) return ko;
        String saved = translated.get(KeywordTranslationService.normalize(part));
        return saved == null || saved.isBlank() ? null : saved;
    }

    /**
     * 키워드 목록을 한글로 바꾸고, 한글로 바꾼 뒤 같아진 것(예: plaid / check pattern -> 체크)은 하나만 남긴다.
     * 사전에 없는 말은 저장된 번역(없으면 GPT 번역)을 쓰고, 그래도 한글이 없으면 화면에 영어 단어로 뜨지 않도록 제외한다.
     */
    private List<String> localizeKeywords(List<String> keywords) {
        Map<String, String> translated = keywordTranslationService.translate(unmappedKeywordParts(keywords));
        Set<String> seen = new LinkedHashSet<>();
        for (String k : keywords) {
            if (k == null || k.isBlank()) continue;
            for (String part : splitJoinedKeyword(k)) {
                String ko = toKorean(part, translated);
                if (ko == null) {
                    System.out.println("[Keyword] 사전에도 번역에도 없어 키워드에서 제외: '" + part + "'");
                    continue;
                }
                seen.add(ko);
            }
        }
        return new ArrayList<>(seen);
    }

    // 여러 값을 이어 쓴 슬롯 값 ("funky and glamorous", "pure & innocent", "chic/modern")을 값마다 나누는 구분자
    private static final java.util.regex.Pattern KEYWORD_JOINER =
            java.util.regex.Pattern.compile("\\s+(?:and|or)\\s+|\\s*[&/,]\\s*");

    /**
     * 채팅 슬롯 추출 규칙이 "화려한" -> "funky and glamorous"처럼 무드를 이어 쓴 문구로 저장하는데, 통째로는 사전에 없어서
     * ("and") 키워드에서 빠지고 펑키도 안 보였다. 값마다 나눠 "펑키", "화려"로 바꾼다.
     * "warm and cozy"처럼 문구 전체가 KO_PHRASES에 있으면 나누지 않는다. 표시 전용 (슬롯·플랜·프롬프트는 그대로).
     */
    private List<String> splitJoinedKeyword(String keyword) {
        String k = keyword.trim();
        if (KO_PHRASES.containsKey(k.toLowerCase())) return List.of(k);
        List<String> parts = Arrays.stream(KEYWORD_JOINER.split(k))
                .map(String::trim)
                .filter(s -> !s.isBlank())
                .toList();
        return parts.isEmpty() ? List.of(k) : parts;
    }

    /**
     * 결과 화면 키워드(최종 이미지 기준): 슬롯 + 플랜(finish/pattern/motif/parts) 키워드에,
     * 수정(refine)으로 누적된 plan.keywordOverrides(add/remove)를 반영한다.
     * 생성 직후에는 overrides가 없으므로 슬롯 + 플랜 키워드만 나온다.
     */
    public List<String> extractDesignKeywords(Map<String, SlotData> slots, DesignSession session, String planJson) {
        return localizeKeywords(rawDesignKeywords(slots, session, planJson));
    }

    /** extractDesignKeywords·extractSlotKeywords가 쓸 말의 번역을 미리 시작해 둔다 — 수정(RefineService)이 이미지를 고치기 전에 부른다. */
    public void prefetchDesignKeywordTranslations(Map<String, SlotData> slots, DesignSession session, String planJson) {
        List<String> candidates = new ArrayList<>(rawDesignKeywords(slots, session, planJson));
        candidates.addAll(extractKeywordsFromSlots(slots, session));
        prefetchKeywordTranslations(candidates);
    }

    /** extractDesignKeywords의 한글로 옮기기 전(영어) 목록 */
    private List<String> rawDesignKeywords(Map<String, SlotData> slots, DesignSession session, String planJson) {
        JsonNode plan = null;
        if (planJson != null && !planJson.isBlank()) {
            try { plan = objectMapper.readTree(planJson); } catch (Exception ignored) {}
        }
        List<String> base = mergeKeywords(referenceSubjectKeyword(plan),
                mergeKeywords(extractKeywordsFromSlots(slots, session), extractPlanKeywords(plan)));
        if (plan == null) return base;

        List<String> removes = new ArrayList<>();
        plan.path("keywordOverrides").path("remove").forEach(n -> removes.add(n.asText("").trim().toLowerCase()));
        List<String> adds = new ArrayList<>();
        plan.path("keywordOverrides").path("add").forEach(n -> {
            String v = n.asText("").trim();
            if (!v.isBlank()) adds.add(v);
        });

        List<String> kept = new ArrayList<>();
        for (String k : base) {
            String lk = k.toLowerCase();
            boolean removed = removes.stream().anyMatch(r -> !r.isBlank() && (lk.contains(r) || r.contains(lk)));
            if (!removed) kept.add(k);
        }
        int room = Math.max(0, MAX_TOTAL_KEYWORDS - adds.size());
        if (kept.size() > room) kept = new ArrayList<>(kept.subList(0, room));
        return mergeKeywords(kept, adds);
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

    /**
     * 슬롯(무드/디자인 타입/모티프/계절/쉐입/컬러)만으로 만든 결과 화면 키워드 — 플랜 키워드(마감/패턴/파츠)와
     * 수정 overrides는 섞지 않는다. 선택지 기반 결과 화면이 수정 후에도 "고른 값"만 보여줄 때 쓴다(표시 전용).
     */
    public List<String> extractSlotKeywords(Map<String, SlotData> slots, DesignSession session) {
        return localizeKeywords(extractKeywordsFromSlots(slots, session));
    }

    /**
     * 결과 화면 컬러 키워드의 원래 hex — extractKeywordsFromSlots가 키워드로 넣는 색(color 슬롯)을
     * 키워드와 같은 한글 표기로 짝지어 준다. 결과 화면은 이 이름의 키워드 칩을 색 스와치 칩으로 바꿔 그린다.
     * 한글로 못 바꾼 색은 키워드에서도 빠지므로(localizeKeywords) 여기서도 뺀다.
     */
    public List<DesignGenerateResponseDto.KeywordColor> extractKeywordColors(Map<String, SlotData> slots) {
        List<DesignGenerateResponseDto.KeywordColor> result = new ArrayList<>();
        Set<String> seenNames = new HashSet<>();
        try {
            Map<String, String> englishNameByHex = new LinkedHashMap<>();
            for (String value : getLiked(slots, "color")) {
                if (!ColorNameService.isHex(value)) continue;
                String hex = value.trim().toUpperCase();
                englishNameByHex.putIfAbsent(hex.startsWith("#") ? hex : "#" + hex, colorNameService.resolveColorName(value));
            }
            Map<String, String> translated = keywordTranslationService.translate(unmappedKeywordParts(englishNameByHex.values()));
            for (Map.Entry<String, String> entry : englishNameByHex.entrySet()) {
                String name = toKorean(entry.getValue(), translated);
                if (name == null || !seenNames.add(name)) continue;
                result.add(DesignGenerateResponseDto.KeywordColor.builder()
                        .hex(entry.getKey())
                        .name(name)
                        .build());
            }
        } catch (Exception e) {
            // 표시용 정보라 실패해도 생성 응답은 그대로 내려간다 (컬러는 키워드 글자로만 보인다)
            System.err.println("[Keyword] 컬러 키워드 hex 정리 실패: " + e.getMessage());
            return new ArrayList<>();
        }
        return result;
    }
}