package com.example.nailyproject.controller;

import com.example.nailyproject.auth.DuplicateException;
import com.example.nailyproject.auth.InvalidCredentialsException;
import com.example.nailyproject.dto.request.LoginRequestDto;
import com.example.nailyproject.dto.request.SignupRequestDto;
import com.example.nailyproject.dto.response.ApiResponse;
import com.example.nailyproject.dto.response.LoginResponseDto;
import com.example.nailyproject.dto.response.SignupResponseDto;
import com.example.nailyproject.dto.response.UserProfileResponseDto;
import com.example.nailyproject.service.UserService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import com.example.nailyproject.entity.User;

@RestController
@RequiredArgsConstructor
@RequestMapping("/users")
public class UserController {

    private final UserService userService;

//회원가입 POST /users/signup
    @PostMapping("/signup")
    public ResponseEntity<ApiResponse<SignupResponseDto>> signup(
            @Valid @RequestBody SignupRequestDto request) {

        SignupResponseDto data = userService.signUp(request);

        return ResponseEntity
                .status(HttpStatus.CREATED) // 201
                .body(ApiResponse.success(201, "회원가입이 완료되었습니다.", data));
    }

    //로그인 POST /users/email/login
    @PostMapping("/email/login")
    public ResponseEntity<ApiResponse<LoginResponseDto>> login(
            @Valid @RequestBody LoginRequestDto request) {

        LoginResponseDto data = userService.login(request);

        return ResponseEntity
                .status(HttpStatus.OK) // 200
                .body(ApiResponse.success(200, "로그인 성공.", data));
    }

    // 내 프로필 조회 GET /users/me
    @GetMapping("/me")
    public ResponseEntity<ApiResponse<UserProfileResponseDto>> getProfile(
            @AuthenticationPrincipal User user) {

        UserProfileResponseDto data = userService.getProfile(user);

        return ResponseEntity.ok(
                ApiResponse.success(200, "사용자 프로필 조회 성공.", data)
        );
    }

//409 - 이메일/닉네임 중복
    @ExceptionHandler(DuplicateException.class)
    public ResponseEntity<ApiResponse<Void>> handleDuplicate(DuplicateException e) {
        return ResponseEntity
                .status(HttpStatus.CONFLICT) // 409
                .body(ApiResponse.fail(409, e.getMessage()));
    }


//400 - 입력값 오류 (@Valid 실패)
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidationError(MethodArgumentNotValidException e) {
        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST) // 400
                .body(ApiResponse.fail(400, "입력값이 올바르지 않습니다."));
    }

    // 401 - 이메일/비밀번호 불일치
    @ExceptionHandler(InvalidCredentialsException.class)
    public ResponseEntity<ApiResponse<Void>> handleInvalidCredentials(InvalidCredentialsException e) {
        return ResponseEntity
                .status(HttpStatus.UNAUTHORIZED) // 401
                .body(ApiResponse.fail(401, e.getMessage()));
    }
}