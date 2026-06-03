package com.example.nailyproject.repository;

import com.example.nailyproject.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> { //클래스,아이디
    boolean existsByEmail(String email);
    boolean existsByNickname(String nickname);

    Optional<User> findByEmail(String email);
}
