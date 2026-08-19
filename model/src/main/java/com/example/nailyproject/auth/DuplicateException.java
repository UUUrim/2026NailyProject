package com.example.nailyproject.auth;

public class DuplicateException extends RuntimeException {

    public static DuplicateException email() {
        return new DuplicateException("이미 존재하는 이메일입니다.");
    }

    public static DuplicateException nickname() {
        return new DuplicateException("이미 존재하는 닉네임입니다.");
    }

    private DuplicateException(String message) {
        super(message);
    }
}