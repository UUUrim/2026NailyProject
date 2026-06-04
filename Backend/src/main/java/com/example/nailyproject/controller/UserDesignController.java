package com.example.nailyproject.controller;

import com.example.nailyproject.dto.response.ApiResponse;
import com.example.nailyproject.dto.response.DesignImageResponseDto;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.service.NailDesignService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequiredArgsConstructor
@RequestMapping("/users/me")
public class UserDesignController {

    private final NailDesignService nailDesignService;

    /**
     * '내 디자인' 전체 목록 조회 GET /users/me/designs
     */
    @GetMapping("/designs")
    public ResponseEntity<ApiResponse<List<DesignImageResponseDto>>> getMyDesigns(
            @AuthenticationPrincipal User user) {

        // Service에 만들어둔 사진 3장 쪼개서 최신순으로 가져오는 로직 실행
        List<DesignImageResponseDto> data = nailDesignService.getUserDesignHistory(user.getId());

        // 통일된 응답 포맷(ApiResponse)으로 감싸서 반환
        return ResponseEntity.ok(
                ApiResponse.success(200, "내 디자인 전체 목록 조회 성공.", data)
        );
    }
}