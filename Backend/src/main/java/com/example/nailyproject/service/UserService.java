package com.example.nailyproject.service;

import com.example.nailyproject.auth.DuplicateException;
import com.example.nailyproject.auth.JwtTokenProvider;
import com.example.nailyproject.dto.request.LoginRequestDto;
import com.example.nailyproject.dto.request.SignupRequestDto;
import com.example.nailyproject.dto.request.UpdateNicknameRequestDto;
import com.example.nailyproject.dto.request.UpdatePasswordRequestDto;
import com.example.nailyproject.dto.response.LoginResponseDto;
import com.example.nailyproject.dto.response.SignupResponseDto;
import com.example.nailyproject.dto.response.UserProfileResponseDto;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.example.nailyproject.auth.InvalidCredentialsException;

@Service
@Transactional
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;
    private final BCryptPasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;

    // 회원가입
    public SignupResponseDto signUp(SignupRequestDto request) {

        // 이메일 중복 확인 (409)
        if (userRepository.existsByEmail(request.getEmail())) {
            throw DuplicateException.email();
        }

        // 닉네임 중복 확인 (409)
        if (userRepository.existsByNickname(request.getNickname())) {
            throw DuplicateException.nickname();
        }

        // 비밀번호 bcrypt 암호화
        String encodedPassword = passwordEncoder.encode(request.getPassword());

        // 유저 저장
        User savedUser = userRepository.save(User.builder()
                .email(request.getEmail())
                .passwordHash(encodedPassword)
                .name(request.getName())
                .nickname(request.getNickname())
                .build());

        // SignupResponseDto 반환
        return SignupResponseDto.builder()
                .userId(savedUser.getId())
                .email(savedUser.getEmail())
                .nickname(savedUser.getNickname())
                .build();
    }

    // 로그인
    public LoginResponseDto login(LoginRequestDto request) {

        // 이메일로 유저 조회 (없으면 401)
        User user = userRepository.findByEmail(request.getEmail())
                .orElseThrow(() -> new InvalidCredentialsException());

        // 비밀번호 검증 (틀리면 401)
        if (!passwordEncoder.matches(request.getPassword(), user.getPasswordHash())) {
            throw new InvalidCredentialsException();
        }

        // JWT 발급
        String token = jwtTokenProvider.generateToken(user.getId(), user.getEmail());

        return LoginResponseDto.builder()
                .userId(user.getId())
                .email(user.getEmail())
                .nickname(user.getNickname())
                .token(token)
                .build();
    }

    //프로필 조회
    @Transactional(readOnly = true)
    public UserProfileResponseDto getProfile(User user) {
        return UserProfileResponseDto.from(user);
    }

    // 닉네임 수정
    public UserProfileResponseDto updateNickname(User user, UpdateNicknameRequestDto request) {

        String newNickname = request.getNickname();

        if (newNickname == null || newNickname.isBlank()) {
            throw new IllegalArgumentException("닉네임을 입력해주세요.");
        }

        if (!user.getNickname().equals(newNickname)
                && userRepository.existsByNickname(newNickname)) {
            throw DuplicateException.nickname();
        }

        // DB에서 다시 조회해서 영속성 컨텍스트에 올리기
        User managedUser = userRepository.findById(user.getId())
                .orElseThrow(() -> new IllegalArgumentException("사용자를 찾을 수 없습니다."));


        managedUser.updateNickname(newNickname);

        return UserProfileResponseDto.from(managedUser);
    }

    // 비밀번호 수정
    public void updatePassword(User user, UpdatePasswordRequestDto request) {

        if (request.getCurrentPassword() == null || request.getCurrentPassword().isBlank()) {
            throw new IllegalArgumentException("현재 비밀번호를 입력해주세요.");
        }

        if (request.getNewPassword() == null || request.getNewPassword().isBlank()) {
            throw new IllegalArgumentException("새 비밀번호를 입력해주세요.");
        }

        if (!passwordEncoder.matches(request.getCurrentPassword(), user.getPasswordHash())) {
            throw new InvalidCredentialsException();
        }

        // DB에서 다시 조회해서 영속성 컨텍스트에 올리기
        User managedUser = userRepository.findById(user.getId())
                .orElseThrow(() -> new IllegalArgumentException("사용자를 찾을 수 없습니다."));


        String encodedNewPassword = passwordEncoder.encode(request.getNewPassword());
        managedUser.updatePasswordHash(encodedNewPassword);
    }
}