package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;


@Getter
@Builder
public class ApiResponse<T> {
    private boolean ok;
    private int status;
    private String message;
    private T data;

    // 성공 응답
    public static <T> ApiResponse<T> success(int status, String message, T data) {
        return ApiResponse.<T>builder()
                .ok(true)
                .status(status)
                .message(message)
                .data(data)
                .build();
    }

    // 실패 응답
    public static <T> ApiResponse<T> fail(int status, String message) {
        return ApiResponse.<T>builder()
                .ok(false)
                .status(status)
                .message(message)
                .data(null)
                .build();
    }
}