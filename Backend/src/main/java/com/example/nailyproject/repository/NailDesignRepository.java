package com.example.nailyproject.repository;


import com.example.nailyproject.entity.NailDesign;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface NailDesignRepository extends JpaRepository<NailDesign, Long> {

    // '수정하고 싶어요' 흐름에서 직전 플랜을 이어서 편집하기 위해, 같은 세션의 가장 최근 디자인을 조회
    java.util.Optional<NailDesign> findTopBySessionIdOrderByGeneratedAtDesc(Long sessionId);

    //User의 Id로 모든 디자인을 찾아서(findAllByUserId), 생성일자 기준 내림차순으로 정렬해라(OrderByCreatedAtDesc)
    List<NailDesign> findAllByUserIdOrderByGeneratedAtDesc(Long userId);

    // 삭제 등 소유권 검증이 필요한 단건 조회
    java.util.Optional<NailDesign> findByIdAndUserId(Long id, Long userId);

    // '둘러보기' 커뮤니티 갤러리용 - 사용자가 공유한 디자인을 최신 공유순으로 조회 (최대 60개)
    List<NailDesign> findTop60BySharedTrueOrderBySharedAtDesc();
}