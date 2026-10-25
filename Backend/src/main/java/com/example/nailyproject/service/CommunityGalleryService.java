package com.example.nailyproject.service;

import com.example.nailyproject.dto.response.CommunityDesignResponseDto;
import com.example.nailyproject.dto.response.DesignDetailResponseDto;
import com.example.nailyproject.dto.response.DesignGenerateResponseDto;
import com.example.nailyproject.dto.response.DesignLikeResponseDto;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.CommunityDesignStore;
import com.example.nailyproject.repository.CommunityDesignStore.CommunityDesign;
import com.example.nailyproject.repository.NailDesignRepository;
import com.example.nailyproject.repository.SavedDesignRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * '둘러보기' 갤러리 — 모든 로컬 DB 사용자가 공유한 디자인을 갤러리 DB(CommunityDesignStore)에서 읽는다.
 * 여기서 쓰는 designId는 갤러리 DB id라서, 로컬 디자인 id를 쓰는 /designs/{designId}와 구분해 /designs/community/{id}로 받는다.
 * 좋아요한 사람은 (이 로컬 DB의 originId, 로컬 user id)로 적는다.
 */
@Service
@RequiredArgsConstructor
public class CommunityGalleryService {

    private static final int GALLERY_LIMIT = 60;

    private final CommunityDesignStore communityDesignStore;
    private final LocalOriginService localOriginService;
    private final NailDesignRepository nailDesignRepository;
    private final SavedDesignRepository savedDesignRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 커뮤니티 갤러리 GET /designs/community
     */
    public List<CommunityDesignResponseDto> getGallery(User user) {
        List<CommunityDesign> designs = communityDesignStore.findShared(GALLERY_LIMIT);

        List<Long> designIds = designs.stream().map(CommunityDesign::id).toList();
        Map<Long, Long> likeCountByDesignId = communityDesignStore.countLikes(designIds);
        Set<Long> myLikedDesignIds = user != null
                ? communityDesignStore.findLikedIds(localOriginService.getOriginId(), user.getId(), designIds)
                : Set.of();

        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy. M. d.");
        List<CommunityDesignResponseDto> resultList = new ArrayList<>();

        for (CommunityDesign design : designs) {
            if (design.imageUrls().isEmpty()) continue;

            LocalDateTime displayAt = design.sharedAt() != null ? design.sharedAt() : design.generatedAt();
            String formattedDate = displayAt != null ? displayAt.format(formatter) : "";

            resultList.add(CommunityDesignResponseDto.builder()
                    .designId(design.id())
                    .imageUrl(design.imageUrls().get(0))
                    .createdAt(formattedDate)
                    .likeCount(likeCountByDesignId.getOrDefault(design.id(), 0L))
                    .likedByMe(myLikedDesignIds.contains(design.id()))
                    .details(parseDetails(design.detailsJson()))
                    .build());
        }

        resultList.sort(Comparator
                .comparingLong(CommunityDesignResponseDto::getLikeCount).reversed()
                .thenComparing(CommunityDesignResponseDto::getCreatedAt, Comparator.nullsLast(Comparator.reverseOrder())));

        return resultList;
    }

    /**
     * 갤러리 디자인 상세 GET /designs/community/{communityDesignId} — 공유할 때 찍어 둔 스냅샷으로 답한다.
     */
    public DesignDetailResponseDto getDetail(User user, Long communityDesignId) {
        CommunityDesign design = findDesign(communityDesignId);

        boolean isOwner = user != null && isFromThisDb(design) && design.ownerUserId().equals(user.getId());
        if (!design.shared() && !isOwner) throw new IllegalArgumentException("공유되지 않은 디자인입니다.");

        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy. M. d. HH:mm");
        String formattedDate = design.generatedAt() != null ? design.generatedAt().format(formatter) : "";

        return DesignDetailResponseDto.builder()
                .designId(design.id())
                .imageUrl(design.imageUrls().isEmpty() ? null : design.imageUrls().get(0))
                .imageUrls(design.imageUrls())
                .createdAt(formattedDate)
                .shared(design.shared())
                .owner(isOwner)
                .details(parseDetails(design.detailsJson()))
                .shape(design.shape())
                .nailTipCropUrls(design.nailTipCropUrls())
                .build();
    }

    public DesignLikeResponseDto addReaction(User user, Long communityDesignId) {
        if (user == null) throw new IllegalArgumentException("로그인이 필요합니다.");
        CommunityDesign design = findDesign(communityDesignId);
        if (!design.shared()) throw new IllegalArgumentException("공유된 디자인만 좋아요할 수 있습니다.");
        communityDesignStore.addLike(communityDesignId, localOriginService.getOriginId(), user.getId(), LocalDateTime.now());
        return DesignLikeResponseDto.builder()
                .designId(communityDesignId)
                .likeCount(communityDesignStore.countLikes(communityDesignId))
                .liked(true).build();
    }

    public DesignLikeResponseDto removeReaction(User user, Long communityDesignId) {
        if (user == null) throw new IllegalArgumentException("로그인이 필요합니다.");
        findDesign(communityDesignId);
        communityDesignStore.removeLike(communityDesignId, localOriginService.getOriginId(), user.getId());
        return DesignLikeResponseDto.builder()
                .designId(communityDesignId)
                .likeCount(communityDesignStore.countLikes(communityDesignId))
                .liked(false).build();
    }

    /**
     * 원본이 이 로컬 DB에 있는 갤러리 디자인이면 그 로컬 디자인 id, 다른 로컬 DB에서 공유된 거면 null.
     * 내 DB 디자인을 둘러보기에서 찜하면 예전처럼 로컬 디자인으로 저장해서, 마이페이지에서 찜한 것과 같은 항목이 되게 한다.
     */
    public Long findLocalDesignId(Long communityDesignId) {
        CommunityDesign design = findDesign(communityDesignId);
        if (!isFromThisDb(design)) return null;
        return nailDesignRepository.existsById(design.originDesignId()) ? design.originDesignId() : null;
    }

    /**
     * 원본이 삭제돼 갤러리 DB에서 사라진 디자인의 찜을 지운다 (다른 DB라 FK로 같이 지울 수 없어서 목록을 읽기 전에 정리).
     * 찜 목록·폴더를 읽는 쪽이 엔티티를 불러오기 전에 불러야 한다. 갤러리 DB에 못 닿으면 그대로 둔다.
     */
    @Transactional
    public void pruneDeletedSaves(User user) {
        List<Long> communityDesignIds = savedDesignRepository.findCommunityDesignIdsByUserId(user.getId());
        if (communityDesignIds.isEmpty()) return;

        Set<Long> existing;
        try {
            existing = communityDesignStore.findExistingIds(communityDesignIds);
        } catch (DataAccessException e) {
            System.err.println("[CommunityGallery] 갤러리 DB에 연결하지 못해 삭제된 찜 정리를 건너뜁니다: " + e.getMessage());
            return;
        }
        List<Long> deleted = communityDesignIds.stream().filter(id -> !existing.contains(id)).toList();
        if (!deleted.isEmpty()) savedDesignRepository.deleteCommunitySaves(user.getId(), deleted);
    }

    private CommunityDesign findDesign(Long communityDesignId) {
        return communityDesignStore.findById(communityDesignId)
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 디자인입니다."));
    }

    private boolean isFromThisDb(CommunityDesign design) {
        return design.originId().equals(localOriginService.getOriginId());
    }

    // 스냅샷의 details JSON → DTO (Details에는 기본 생성자가 없어 빌더로 다시 만든다)
    private DesignGenerateResponseDto.Details parseDetails(String detailsJson) {
        if (detailsJson == null || detailsJson.isBlank()) return null;
        try {
            JsonNode node = objectMapper.readTree(detailsJson);
            List<String> colorPalette = new ArrayList<>();
            node.path("colorPalette").forEach(v -> colorPalette.add(v.asText()));
            List<String> textures = new ArrayList<>();
            node.path("textures").forEach(v -> textures.add(v.asText()));
            Map<String, String> swatches = new LinkedHashMap<>();
            node.path("swatches").fields().forEachRemaining(e -> swatches.put(e.getKey(), e.getValue().asText()));
            return DesignGenerateResponseDto.Details.builder()
                    .colorPalette(colorPalette)
                    .textures(textures)
                    .swatches(swatches.isEmpty() ? null : swatches)
                    .build();
        } catch (Exception e) {
            System.err.println("[CommunityGallery] details 파싱 실패: " + e.getMessage());
            return null;
        }
    }
}
