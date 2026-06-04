package com.example.nailyproject.controller;

import com.example.nailyproject.dto.response.ApiResponse;
import com.example.nailyproject.dto.response.SavedDesignResponseDto;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.service.SavedDesignService;
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

    //프론트엔드에서 보내는 '사진 주소'를 담을 작은 바구니(DTO) 추가
    @Getter
    public static class LikeRequest {
        private String imageUrl;
    }

    // 찜하기 (POST /designs/{designId}/likes)
    @PostMapping("/designs/{designId}/likes")
    public ResponseEntity<ApiResponse<Void>> addLike(
            @AuthenticationPrincipal User user,
            @PathVariable Long designId,
            @RequestBody LikeRequest request) { // 프론트에서 사진 주소 받기

        //서비스에 3개의 데이터(user, designId, imageUrl)를 전달
        savedDesignService.addLike(user, designId, request.getImageUrl());
        return ResponseEntity.ok(ApiResponse.success(200, "개별 이미지 찜하기 성공.", null));
    }

    // 찜 취소 (DELETE /designs/{designId}/likes)
    @DeleteMapping("/designs/{designId}/likes")
    public ResponseEntity<ApiResponse<Void>> removeLike(
            @AuthenticationPrincipal User user,
            @PathVariable Long designId,
            @RequestBody LikeRequest request) { // 프론트에서 취소할 사진 주소 받기

        // 서비스에 3개의 데이터 전달
        savedDesignService.removeLike(user, designId, request.getImageUrl());
        return ResponseEntity.ok(ApiResponse.success(200, "개별 이미지 찜 취소 성공.", null));
    }

    //찜 목록 전체 조회 (GET /users/me/liked-designs)
    @GetMapping("/users/me/liked-designs")
    public ResponseEntity<ApiResponse<List<SavedDesignResponseDto>>> getSavedDesigns(
            @AuthenticationPrincipal User user) {

        List<SavedDesignResponseDto> data = savedDesignService.getSavedDesigns(user);
        return ResponseEntity.ok(ApiResponse.success(200, "저장 디자인 목록 조회 성공.", data));
    }
}