package com.example.nailyproject.controller;

import com.example.nailyproject.dto.response.ApiResponse;
import com.example.nailyproject.dto.response.SavedDesignResponseDto;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.service.SavedDesignService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequiredArgsConstructor
@RequestMapping("/users/me")
public class SavedDesignController {

    private final SavedDesignService savedDesignService;


    //저장 디자인 전체 목록 조회 GET /users/me/liked-designs
    @GetMapping("/liked-designs")
    public ResponseEntity<ApiResponse<List<SavedDesignResponseDto>>> getSavedDesigns(
            @AuthenticationPrincipal User user) {

        List<SavedDesignResponseDto> data = savedDesignService.getSavedDesigns(user);

        return ResponseEntity.ok(
                ApiResponse.success(200, "저장 디자인 목록 조회 성공.", data)
        );
    }
}