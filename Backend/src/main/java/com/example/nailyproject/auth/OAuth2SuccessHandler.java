package com.example.nailyproject.auth;

import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.UserRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.Map;

@Component
@RequiredArgsConstructor
public class OAuth2SuccessHandler implements AuthenticationSuccessHandler {

    private final JwtTokenProvider jwtTokenProvider;
    private final UserRepository userRepository;

    // 배포 시 실제 프론트 도메인으로 변경 필요!!
    private static final String REDIRECT_URI = "http://localhost:5173/oauth/callback";

    @Override
    public void onAuthenticationSuccess(HttpServletRequest request, HttpServletResponse response,
                                        Authentication authentication) throws IOException {

        OAuth2User oAuth2User = (OAuth2User) authentication.getPrincipal();

        // 어떤 provider로 로그인했는지 확인 (google / naver)
        String registrationId = ((OAuth2AuthenticationToken) authentication).getAuthorizedClientRegistrationId();

        String email;
        if ("naver".equals(registrationId)) {
            Map<String, Object> naverResponse = oAuth2User.getAttribute("response");
            email = (String) naverResponse.get("email");
        } else {
            email = oAuth2User.getAttribute("email");
        }

        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new IllegalStateException("사용자를 찾을 수 없습니다."));

        String token = jwtTokenProvider.generateToken(user.getId(), user.getEmail());

        String redirectUrl = REDIRECT_URI + "?token=" + token;
        response.sendRedirect(redirectUrl);
    }
}
