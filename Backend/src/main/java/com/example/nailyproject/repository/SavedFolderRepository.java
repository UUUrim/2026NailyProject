package com.example.nailyproject.repository;

import com.example.nailyproject.entity.SavedFolder;
import com.example.nailyproject.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface SavedFolderRepository extends JpaRepository<SavedFolder, Long> {

    List<SavedFolder> findAllByUserOrderBySortOrderAscCreatedAtAsc(User user);

    Optional<SavedFolder> findByIdAndUser(Long id, User user);

    // 과거 레이스 컨디션으로 기본 폴더가 중복 생성된 경우를 대비해 단건이 아닌 리스트로 조회한다.
    // (단건 조회 findByUserAndDefaultFolderTrue 는 결과가 2건 이상이면
    //  "Query did not return a unique result" 예외를 던지므로 더 이상 사용하지 않는다.)
    List<SavedFolder> findAllByUserAndDefaultFolderTrue(User user);

    Optional<SavedFolder> findByUserAndName(User user, String name);

    @Query("select coalesce(max(f.sortOrder), -1) from SavedFolder f where f.user = :user")
    Integer findMaxSortOrderByUser(@Param("user") User user);
}