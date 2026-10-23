package com.example.nailyproject.controller;

import com.example.nailyproject.dto.response.ApiResponse;
import com.example.nailyproject.dto.response.CommunityDesignResponseDto;
import com.example.nailyproject.dto.response.DesignDetailResponseDto;
import com.example.nailyproject.dto.response.DesignLikeResponseDto;
import com.example.nailyproject.dto.response.SavedDesignResponseDto;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.service.CommunityGalleryService;
import com.example.nailyproject.service.SavedDesignService;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * '둘러보기' 갤러리 API. 경로의 id는 갤러리 DB id라서 로컬 디자인 id를 쓰는 /designs/{designId}와 따로 둔다.
 * (SecurityConfig의 /designs/** permitAll로 비로그인도 목록·상세는 볼 수 있다)
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/designs/community")
public class CommunityController {

    private final CommunityGalleryService communityGalleryService;
    private final SavedDesignService savedDesignService;

    /**
     * '둘러보기' 커뮤니티 갤러리 GET /designs/community
     * 로그인 상태면 각 디자인에 내가 좋아요 눌렀는지(likedByMe)도 내려준다.
     */
    @GetMapping
    public ResponseEntity<ApiResponse<List<CommunityDesignResponseDto>>> getCommunityDesigns(
            @AuthenticationPrincipal User user) {

        var data = communityGalleryService.getGallery(user);
        return ResponseEntity.ok(ApiResponse.success(200, "둘러보기 갤러리 조회 성공.", data));
    }

    /** 갤러리 디자인 상세 GET /designs/community/{communityDesignId} */
    @GetMapping("/{communityDesignId}")
    public ResponseEntity<ApiResponse<DesignDetailResponseDto>> getCommunityDesignDetail(
            @AuthenticationPrincipal User user,
            @PathVariable Long communityDesignId) {

        var data = communityGalleryService.getDetail(user, communityDesignId);
        return ResponseEntity.ok(ApiResponse.success(200, "디자인 상세 조회 성공.", data));
    }

    /** 둘러보기 좋아요 (찜 /likes 와 완전 분리) */
    @PostMapping("/{communityDesignId}/reactions")
    public ResponseEntity<ApiResponse<DesignLikeResponseDto>> addReaction(
            @AuthenticationPrincipal User user,
            @PathVariable Long communityDesignId) {

        var data = communityGalleryService.addReaction(user, communityDesignId);
        return ResponseEntity.ok(ApiResponse.success(200, "좋아요를 반영했습니다.", data));
    }

    @DeleteMapping("/{communityDesignId}/reactions")
    public ResponseEntity<ApiResponse<DesignLikeResponseDto>> removeReaction(
            @AuthenticationPrincipal User user,
            @PathVariable Long communityDesignId) {

        var data = communityGalleryService.removeReaction(user, communityDesignId);
        return ResponseEntity.ok(ApiResponse.success(200, "좋아요를 취소했습니다.", data));
    }

    /** 둘러보기에서 찜하기 — 다른 로컬 DB에서 공유된 디자인도 내 찜 목록에 저장된다 */
    @PostMapping("/{communityDesignId}/likes")
    public ResponseEntity<ApiResponse<SavedDesignResponseDto>> addLike(
            @AuthenticationPrincipal User user,
            @PathVariable Long communityDesignId,
            @RequestBody SavedDesignController.LikeRequest request) {

        SavedDesignResponseDto data = savedDesignService.addCommunityLike(
                user, communityDesignId, request.getImageUrl(), request.getFolderId(), request.getNewFolderName());
        return ResponseEntity.ok(ApiResponse.success(200, "개별 이미지 찜하기 성공.", data));
    }

    @DeleteMapping("/{communityDesignId}/likes")
    public ResponseEntity<ApiResponse<Void>> removeLike(
            @AuthenticationPrincipal User user,
            @PathVariable Long communityDesignId,
            @RequestBody SavedDesignController.LikeRequest request) {

        savedDesignService.removeCommunityLike(user, communityDesignId, request.getImageUrl());
        return ResponseEntity.ok(ApiResponse.success(200, "개별 이미지 찜 취소 성공.", null));
    }

    @PatchMapping("/{communityDesignId}/likes")
    public ResponseEntity<ApiResponse<SavedDesignResponseDto>> moveLike(
            @AuthenticationPrincipal User user,
            @PathVariable Long communityDesignId,
            @RequestBody SavedDesignController.LikeRequest request) {

        SavedDesignResponseDto data = savedDesignService.moveCommunityLike(
                user, communityDesignId, request.getImageUrl(), request.getFolderId(), request.getNewFolderName());
        return ResponseEntity.ok(ApiResponse.success(200, "찜 저장 위치가 변경되었습니다.", data));
    }

    /**
     * 400 - 잘못된 요청 (없는 디자인, 공유 안 된 디자인, 이미 찜함 등)
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiResponse<Void>> handleBadRequest(IllegalArgumentException e) {
        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.fail(400, e.getMessage()));
    }

    /**
     * 503 - 갤러리 DB(RDS)에 연결하지 못함. 둘러보기만 안 되고 나머지 기능은 로컬 DB로 정상 동작한다.
     */
    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<ApiResponse<Void>> handleGalleryDbDown(DataAccessException e) {
        System.err.println("[CommunityGallery] 갤러리 DB 오류: " + e.getMessage());
        return ResponseEntity
                .status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(ApiResponse.fail(503, "둘러보기 저장소에 연결하지 못했어요. 잠시 후 다시 시도해 주세요."));
    }
}
