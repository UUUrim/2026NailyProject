package com.example.nailyproject.dto.response;

import com.example.nailyproject.entity.User;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDateTime;

@Getter
@Builder
public class UserProfileResponseDto {

    private Long userId;
    private String email;
    private String name;
    private String nickname;
    private String provider;
    private LocalDateTime createdAt;

    public static UserProfileResponseDto from(User user) {
        return UserProfileResponseDto.builder()
                .userId(user.getId())
                .email(user.getEmail())
                .name(user.getName())
                .nickname(user.getNickname())
                .provider(user.getProvider())
                .createdAt(user.getCreatedAt())
                .build();
    }
}