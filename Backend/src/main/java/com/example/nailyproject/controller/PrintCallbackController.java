package com.example.nailyproject.controller;

import com.example.nailyproject.dto.response.ApiResponse;
import com.example.nailyproject.service.PrintOrderService;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/prints")
public class PrintCallbackController {

    private final PrintOrderService printOrderService;

    /**
     * printer/server.py의 /print/merge(-both) 완료 콜백.
     * 인증 없음 — 로컬 printer 서버(ngrok 경유)가 직접 호출하는 웹훅.
     */
    @PostMapping("/{orderId}/merge-result")
    public ResponseEntity<ApiResponse<Void>> receiveMergeResult(
            @PathVariable Long orderId,
            @RequestBody JsonNode payload) {

        printOrderService.receiveMergeResult(orderId, payload);
        return ResponseEntity.ok(ApiResponse.success(200, "병합 결과 수신 완료.", null));
    }

    /**
     * printer/server.py의 /print/start 완료 콜백.
     */
    @PostMapping("/{orderId}/print-result")
    public ResponseEntity<ApiResponse<Void>> receivePrintResult(
            @PathVariable Long orderId,
            @RequestBody JsonNode payload) {

        printOrderService.receivePrintResult(orderId, payload);
        return ResponseEntity.ok(ApiResponse.success(200, "출력 결과 수신 완료.", null));
    }
}
