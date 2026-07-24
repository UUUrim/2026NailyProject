package com.example.nailyproject.service;

import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.oauth2.client.userinfo.DefaultOAuth2UserService;
import org.springframework.security.oauth2.client.userinfo.OAuth2UserRequest;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.stereotype.Service;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class CustomOAuth2UserService extends DefaultOAuth2UserService {

    private final UserRepository userRepository;

    @Override
    public OAuth2User loadUser(OAuth2UserRequest userRequest) throws OAuth2AuthenticationException {
        OAuth2User oAuth2User = super.loadUser(userRequest);

        String registrationId = userRequest.getClientRegistration().getRegistrationId(); // "google" or "naver"

        String email;
        String name;
        String providerId;

        if ("naver".equals(registrationId)) {
            Map<String, Object> response = oAuth2User.getAttribute("response");
            email = (String) response.get("email");
            name = (String) response.get("name");
            providerId = (String) response.get("id");
        } else { // google
            email = oAuth2User.getAttribute("email");
            name = oAuth2User.getAttribute("name");
            providerId = oAuth2User.getAttribute("sub");
        }

        final String finalEmail = email;
        final String finalName = name;
        final String finalProviderId = providerId;
        final String finalProvider = registrationId; // "google" or "naver"

        userRepository.findByEmail(email).ifPresentOrElse(
                existingUser -> {
                    if ("local".equals(existingUser.getProvider())) {
                        throw new OAuth2AuthenticationException(
                                new OAuth2Error("account_conflict"),
                                "이미 이메일/비밀번호로 가입된 계정입니다. 일반 로그인을 이용해주세요."
                        );
                    }
                },
                () -> userRepository.save(User.builder()
                        .email(finalEmail)
                        .name(finalName)
                        .nickname(generateDefaultNickname(finalEmail))
                        .provider(finalProvider)
                        .providerId(finalProviderId)
                        .build())
        );

        return oAuth2User;
    }

    // 닉네임 중복을 피하기 위한 기본 닉네임 생성 (이메일 앞부분 + 랜덤 숫자)
    private String generateDefaultNickname(String email) {
        String base = email.split("@")[0];
        String candidate = base;
        int suffix = 1;
        while (userRepository.existsByNickname(candidate)) {
            candidate = base + suffix++;
        }
        return candidate;
    }
}