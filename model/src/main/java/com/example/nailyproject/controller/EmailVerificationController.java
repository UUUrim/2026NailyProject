package com.example.nailyproject.controller;

import com.example.nailyproject.dto.response.ApiResponse;
import com.example.nailyproject.service.EmailVerificationService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import com.example.nailyproject.auth.DuplicateException;
import com.example.nailyproject.repository.UserRepository;

@RestController
@RequiredArgsConstructor
@RequestMapping("/users")
public class EmailVerificationController {

    private final EmailVerificationService emailVerificationService;
    private final UserRepository userRepository;

    //인증코드 발송 POST /users/email/send
    @PostMapping("/email/send")
    public ResponseEntity<ApiResponse<Void>> sendCode(@RequestParam String email) {

        // 이메일 중복 확인 추가
        if (userRepository.existsByEmail(email)) {
            throw DuplicateException.email();
        }
        emailVerificationService.sendVerificationCode(email);
        return ResponseEntity.ok(
                ApiResponse.success(200, "인증코드가 발송되었습니다.", null)
        );
    }

    //인증코드 검증 POST /users/email/verify
    @PostMapping("/email/verify")
    public ResponseEntity<ApiResponse<Void>> verifyCode(
            @RequestParam String email,
            @RequestParam String code) {

        boolean isValid = emailVerificationService.verifyCode(email, code);

        if (isValid) {
            return ResponseEntity.ok(
                    ApiResponse.success(200, "인증이 완료되었습니다.", null)
            );
        } else {
            return ResponseEntity.badRequest().body(
                    ApiResponse.fail(400, "인증코드가 올바르지 않습니다.")
            );
        }
    }
}