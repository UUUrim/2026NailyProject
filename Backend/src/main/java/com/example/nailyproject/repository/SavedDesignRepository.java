package com.example.nailyproject.repository;

import com.example.nailyproject.entity.NailDesign;
import com.example.nailyproject.entity.SavedDesign;
import com.example.nailyproject.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface SavedDesignRepository extends JpaRepository<SavedDesign, Long> {

    //이미 찜한 '이미지'인지 확인
    boolean existsByUserAndNailDesignAndImageUrl(User user, NailDesign nailDesign, String imageUrl);

    //찜 취소할 때 찾기용
    Optional<SavedDesign> findByUserAndNailDesignAndImageUrl(User user, NailDesign nailDesign, String imageUrl);

    // 다른 로컬 DB에서 공유된 디자인(갤러리 id) 찜 확인/취소용
    boolean existsByUserAndCommunityDesignIdAndImageUrl(User user, Long communityDesignId, String imageUrl);

    Optional<SavedDesign> findByUserAndCommunityDesignIdAndImageUrl(User user, Long communityDesignId, String imageUrl);

    // 3. 찜 목록 화면에 뿌려줄 때 최신순으로 가져오기 (갤러리 id로 찜한 건 nailDesign이 없어서 left join)
    @Query("""
            select sd from SavedDesign sd
            left join fetch sd.nailDesign
            left join fetch sd.savedFolder
            where sd.user.id = :userId
            order by sd.savedAt desc
            """)
    List<SavedDesign> findAllByUserIdOrderBySavedAtDesc(@Param("userId") Long userId);

    void deleteAllByNailDesign(NailDesign nailDesign);

    @Query("""
            select distinct sd.communityDesignId from SavedDesign sd
            where sd.user.id = :userId and sd.communityDesignId is not null
            """)
    List<Long> findCommunityDesignIdsByUserId(@Param("userId") Long userId);

    // 원본이 삭제돼 갤러리 DB에서 사라진 찜 정리 (같은 요청이 겹쳐도 행 수 검사 없이 지우도록 벌크 삭제)
    @Modifying
    @Query("""
            delete from SavedDesign sd
            where sd.user.id = :userId and sd.communityDesignId in :communityDesignIds
            """)
    int deleteCommunitySaves(@Param("userId") Long userId,
                             @Param("communityDesignIds") Collection<Long> communityDesignIds);
}
