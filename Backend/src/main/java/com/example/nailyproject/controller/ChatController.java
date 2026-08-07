package com.example.nailyproject.controller;

import com.example.nailyproject.dto.request.ChatMessageRequestDto;
import com.example.nailyproject.dto.response.ApiResponse;
import com.example.nailyproject.dto.response.ChatResponseDto;
import com.example.nailyproject.entity.DesignSession;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.service.ChatService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequiredArgsConstructor
@RequestMapping("/chats")
public class ChatController {

    private final ChatService chatService;

    //채팅 세션 생성 POST /chats/session
    @PostMapping("/session")
    public ResponseEntity<ApiResponse<Map<String, Long>>> createSession(
            @AuthenticationPrincipal User user) {

        DesignSession session = chatService.createSession(user);

        return ResponseEntity
                .status(HttpStatus.CREATED) // 201
                .body(ApiResponse.success(201, "채팅 세션이 생성되었습니다.",
                        Map.of("sessionId", session.getId())));
    }

    //채팅 메시지 전송 POST /chats/{sessionId}/messages
    @PostMapping("/{sessionId}/messages")
    public ResponseEntity<ApiResponse<ChatResponseDto>> sendMessage(
            @AuthenticationPrincipal User user,
            @PathVariable Long sessionId,
            @Valid @RequestBody ChatMessageRequestDto request) {

        ChatResponseDto data = chatService.chat(user, sessionId, request.getMessage()); //사용자가 채팅으로 메세지 보내면 이걸 ChatService에 넘김 + 제미나이 응답 받아서 돌려주는 거까지

        return ResponseEntity.ok(
                ApiResponse.success(200, "채팅메세지 전송 성공.", data));
    }

    //400 입력값 오류
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidationError(MethodArgumentNotValidException e) {
        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.fail(400, "메시지를 입력해주세요."));
    }

    //404
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiResponse<Void>> handleNotFound(IllegalArgumentException e) {
        return ResponseEntity
                .status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.fail(404, e.getMessage()));
    }

    //400 스캔 없
    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<ApiResponse<Void>> handleIllegalState(IllegalStateException e) {
        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.fail(400, e.getMessage()));
    }
}
