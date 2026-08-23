package com.example.nailyproject.controller;

import com.example.nailyproject.dto.response.ApiResponse;
import com.example.nailyproject.dto.response.DesignLikeResponseDto;
import com.example.nailyproject.dto.response.SavedDesignResponseDto;
import com.example.nailyproject.dto.response.SavedFolderResponseDto;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.service.NailDesignService;
import com.example.nailyproject.service.SavedDesignService;
import com.example.nailyproject.service.SavedFolderService;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequiredArgsConstructor
public class SavedDesignController {

    private final SavedDesignService savedDesignService;
    private final SavedFolderService savedFolderService;
    private final NailDesignService nailDesignService;

    @Getter
    public static class LikeRequest {
        private String imageUrl;
        private Long folderId;
        private String newFolderName;
    }

    @Getter
    public static class CreateFolderRequest {
        private String name;
    }

    @Getter
    public static class ReorderFoldersRequest {
        private List<Long> folderIds;
    }

    @PostMapping("/designs/{designId}/likes")
    public ResponseEntity<ApiResponse<SavedDesignResponseDto>> addLike(
            @AuthenticationPrincipal User user,
            @PathVariable Long designId,
            @RequestBody LikeRequest request) {

        SavedDesignResponseDto data = savedDesignService.addLike(
                user,
                designId,
                request.getImageUrl(),
                request.getFolderId(),
                request.getNewFolderName()
        );
        return ResponseEntity.ok(ApiResponse.success(200, "개별 이미지 찜하기 성공.", data));
    }

    /** 둘러보기 좋아요 (찜 /likes 와 완전 분리) */
    @PostMapping("/designs/{designId}/reactions")
    public ResponseEntity<ApiResponse<DesignLikeResponseDto>> addDesignReaction(
            @AuthenticationPrincipal User user,
            @PathVariable Long designId) {

        DesignLikeResponseDto data = nailDesignService.addDesignLike(user, designId);
        return ResponseEntity.ok(ApiResponse.success(200, "좋아요를 반영했습니다.", data));
    }

    @DeleteMapping("/designs/{designId}/reactions")
    public ResponseEntity<ApiResponse<DesignLikeResponseDto>> removeDesignReaction(
            @AuthenticationPrincipal User user,
            @PathVariable Long designId) {

        DesignLikeResponseDto data = nailDesignService.removeDesignLike(user, designId);
        return ResponseEntity.ok(ApiResponse.success(200, "좋아요를 취소했습니다.", data));
    }

    @DeleteMapping("/designs/{designId}/likes")
    public ResponseEntity<ApiResponse<Void>> removeLike(
            @AuthenticationPrincipal User user,
            @PathVariable Long designId,
            @RequestBody LikeRequest request) {

        savedDesignService.removeLike(user, designId, request.getImageUrl());
        return ResponseEntity.ok(ApiResponse.success(200, "개별 이미지 찜 취소 성공.", null));
    }

    @PatchMapping("/designs/{designId}/likes")
    public ResponseEntity<ApiResponse<SavedDesignResponseDto>> moveLike(
            @AuthenticationPrincipal User user,
            @PathVariable Long designId,
            @RequestBody LikeRequest request) {

        SavedDesignResponseDto data = savedDesignService.moveLike(
                user,
                designId,
                request.getImageUrl(),
                request.getFolderId(),
                request.getNewFolderName()
        );
        return ResponseEntity.ok(ApiResponse.success(200, "찜 저장 위치가 변경되었습니다.", data));
    }

    @GetMapping("/users/me/liked-designs")
    public ResponseEntity<ApiResponse<List<SavedDesignResponseDto>>> getSavedDesigns(
            @AuthenticationPrincipal User user) {

        List<SavedDesignResponseDto> data = savedDesignService.getSavedDesigns(user);
        return ResponseEntity.ok(ApiResponse.success(200, "저장 디자인 목록 조회 성공.", data));
    }

    @GetMapping("/users/me/saved-folders")
    public ResponseEntity<ApiResponse<List<SavedFolderResponseDto>>> getMyFolders(
            @AuthenticationPrincipal User user) {

        List<SavedFolderResponseDto> data = savedFolderService.getMyFolders(user);
        return ResponseEntity.ok(ApiResponse.success(200, "찜 폴더 목록 조회 성공.", data));
    }

    @PostMapping("/users/me/saved-folders")
    public ResponseEntity<ApiResponse<SavedFolderResponseDto>> createFolder(
            @AuthenticationPrincipal User user,
            @RequestBody CreateFolderRequest request) {

        SavedFolderResponseDto data = savedFolderService.createFolder(user, request.getName());
        return ResponseEntity.ok(ApiResponse.success(200, "찜 폴더가 생성되었습니다.", data));
    }

    @PatchMapping("/users/me/saved-folders/reorder")
    public ResponseEntity<ApiResponse<Void>> reorderFolders(
            @AuthenticationPrincipal User user,
            @RequestBody ReorderFoldersRequest request) {

        savedFolderService.reorderFolders(user, request.getFolderIds());
        return ResponseEntity.ok(ApiResponse.success(200, "폴더 순서가 저장되었습니다.", null));
    }

    @DeleteMapping("/users/me/saved-folders/{folderId}")
    public ResponseEntity<ApiResponse<Void>> deleteFolder(
            @AuthenticationPrincipal User user,
            @PathVariable Long folderId) {

        savedFolderService.deleteFolder(user, folderId);
        return ResponseEntity.ok(ApiResponse.success(200, "폴더가 삭제되었습니다. 폴더 안의 찜 이미지는 기본 폴더로 이동되었습니다.", null));
    }

    /**
     * 400 - 잘못된 요청 (예: 기본 폴더 삭제 시도, 존재하지 않는 폴더 등)
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiResponse<Void>> handleBadRequest(IllegalArgumentException e) {
        return ResponseEntity
                .status(400)
                .body(ApiResponse.fail(400, e.getMessage()));
    }
}