package com.example.nailyproject.controller;

import com.example.nailyproject.dto.request.ChatMessageRequestDto;
import com.example.nailyproject.dto.request.ChatStateSaveRequestDto;
import com.example.nailyproject.dto.request.ChatTitleUpdateRequestDto;
import com.example.nailyproject.dto.response.ApiResponse;
import com.example.nailyproject.dto.response.ChatResponseDto;
import com.example.nailyproject.dto.response.ChatSearchResultDto;
import com.example.nailyproject.dto.response.ChatStateResponseDto;
import com.example.nailyproject.dto.response.ChatSummaryDto;
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

import java.util.List;
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

    // ── 디자인 채팅 사이드바의 채팅 이력 ──

    //저장된 채팅 목록 GET /chats/sessions
    @GetMapping("/sessions")
    public ResponseEntity<ApiResponse<List<ChatSummaryDto>>> getChatSummaries(
            @AuthenticationPrincipal User user) {

        return ResponseEntity.ok(
                ApiResponse.success(200, "채팅 목록 조회 성공.", chatService.getChatSummaries(user)));
    }

    //채팅 검색 GET /chats/search?q=단어 — 채팅 이름이나 대화 내용에 그 단어가 들어간 채팅
    @GetMapping("/search")
    public ResponseEntity<ApiResponse<List<ChatSearchResultDto>>> searchChats(
            @AuthenticationPrincipal User user,
            @RequestParam(name = "q", defaultValue = "") String query) {

        return ResponseEntity.ok(
                ApiResponse.success(200, "채팅 검색 성공.", chatService.searchChats(user, query)));
    }

    //저장된 채팅 화면 상태 GET /chats/{sessionId}/state
    @GetMapping("/{sessionId}/state")
    public ResponseEntity<ApiResponse<ChatStateResponseDto>> getChatState(
            @AuthenticationPrincipal User user,
            @PathVariable Long sessionId) {

        return ResponseEntity.ok(
                ApiResponse.success(200, "채팅 불러오기 성공.", chatService.getChatState(user, sessionId)));
    }

    //채팅 화면 상태 저장 PUT /chats/{sessionId}/state
    @PutMapping("/{sessionId}/state")
    public ResponseEntity<ApiResponse<ChatSummaryDto>> saveChatState(
            @AuthenticationPrincipal User user,
            @PathVariable Long sessionId,
            @RequestBody ChatStateSaveRequestDto request) {

        return ResponseEntity.ok(
                ApiResponse.success(200, "채팅 저장 성공.", chatService.saveChatState(user, sessionId, request)));
    }

    //채팅 이력에서 지우기 DELETE /chats/{sessionId} — 이 채팅으로 만든 디자인은 남는다
    @DeleteMapping("/{sessionId}")
    public ResponseEntity<ApiResponse<Void>> deleteChat(
            @AuthenticationPrincipal User user,
            @PathVariable Long sessionId) {

        chatService.deleteChat(user, sessionId);
        return ResponseEntity.ok(
                ApiResponse.success(200, "채팅 삭제 성공.", null));
    }

    //채팅 이름 바꾸기 PATCH /chats/{sessionId}/title
    @PatchMapping("/{sessionId}/title")
    public ResponseEntity<ApiResponse<ChatSummaryDto>> renameChat(
            @AuthenticationPrincipal User user,
            @PathVariable Long sessionId,
            @Valid @RequestBody ChatTitleUpdateRequestDto request) {

        return ResponseEntity.ok(
                ApiResponse.success(200, "채팅 이름 변경 성공.", chatService.renameChat(user, sessionId, request.getTitle())));
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
