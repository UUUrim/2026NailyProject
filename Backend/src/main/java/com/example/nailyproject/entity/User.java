package com.example.nailyproject.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "users")
@Getter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name="id", nullable = false, unique = true)
    private Long id;

    @Column(name="email", nullable = false, unique = true, length = 255)
    private String email;

//    @Column(name="provider", nullable = false, unique = true, length = 50)
//    private String provider;

    @Column(name = "password_hash", nullable = false, length = 255)
    private String passwordHash;

    @Column(name="name", nullable = false, length = 50)
    private String name;

    @Column(name="nickname", nullable = false, length = 50)
    private String nickname;

    @Column(name = "provider", nullable = false, length = 20)
    @Builder.Default
    private String provider = "local"; // "local", "google", "naver"

    @Column(name = "provider_id", length = 255)
    private String providerId; // 소셜 로그인 고유 ID (일반 가입은 null)

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    public void updateNickname(String nickname) {
        this.nickname = nickname;
    }

    public void updatePasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
    }
}