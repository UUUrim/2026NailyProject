package com.example.nailyproject.repository;

import com.example.nailyproject.entity.DesignLike;
import com.example.nailyproject.entity.NailDesign;
import com.example.nailyproject.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface DesignLikeRepository extends JpaRepository<DesignLike, Long> {

    boolean existsByUserAndNailDesign(User user, NailDesign nailDesign);

    Optional<DesignLike> findByUserAndNailDesign(User user, NailDesign nailDesign);

    long countByNailDesign(NailDesign nailDesign);

    @Query("""
            select dl.nailDesign.id, count(dl)
            from DesignLike dl
            where dl.nailDesign.id in :designIds
            group by dl.nailDesign.id
            """)
    List<Object[]> countLikesByDesignIds(@Param("designIds") Collection<Long> designIds);

    @Query("""
            select dl.nailDesign.id
            from DesignLike dl
            where dl.user.id = :userId
            """)
    List<Long> findDesignIdsByUserId(@Param("userId") Long userId);

    void deleteAllByNailDesign(NailDesign nailDesign);
}
