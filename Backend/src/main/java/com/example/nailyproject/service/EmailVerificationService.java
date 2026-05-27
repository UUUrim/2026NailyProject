package com.example.nailyproject.service;

import lombok.RequiredArgsConstructor;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.Random;
import java.util.concurrent.ConcurrentHashMap;

@Service
@RequiredArgsConstructor
public class EmailVerificationService {

    private final JavaMailSender mailSender;

    // 이메일 → 인증코드 임시 저장 (DB 대신 메모리 사용)
    private final Map<String, String> codeStore = new ConcurrentHashMap<>();

    //인증코드 발송
    public void sendVerificationCode(String email) {
        String code = generateCode();
        codeStore.put(email, code);

        SimpleMailMessage message = new SimpleMailMessage();
        message.setTo(email);
        message.setSubject("[Naily] 이메일 인증코드");
        message.setText("인증코드: " + code + "\n\n5분 이내에 입력해주세요.");
        mailSender.send(message);
    }

    //인증코드 검증
    public boolean verifyCode(String email, String inputCode) {
        String savedCode = codeStore.get(email);
        if (savedCode != null && savedCode.equals(inputCode)) {
            codeStore.remove(email); // 인증 완료 후 삭제
            return true;
        }
        return false;
    }

    //6자리 랜덤 수 만들기
    private String generateCode() {
        return String.format("%06d", new Random().nextInt(1000000));
    }
}