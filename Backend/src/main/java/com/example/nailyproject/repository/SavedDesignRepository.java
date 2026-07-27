package com.example.nailyproject.repository;

import com.example.nailyproject.entity.NailDesign;
import com.example.nailyproject.entity.SavedDesign;
import com.example.nailyproject.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface SavedDesignRepository extends JpaRepository<SavedDesign, Long> {

    //이미 찜한 '이미지'인지 확인
    boolean existsByUserAndNailDesignAndImageUrl(User user, NailDesign nailDesign, String imageUrl);

    //찜 취소할 때 찾기용
    Optional<SavedDesign> findByUserAndNailDesignAndImageUrl(User user, NailDesign nailDesign, String imageUrl);

    // 3. 찜 목록 화면에 뿌려줄 때 최신순으로 가져오기
    List<SavedDesign> findAllByUserIdOrderBySavedAtDesc(Long userId);

    void deleteAllByNailDesign(NailDesign nailDesign);
}