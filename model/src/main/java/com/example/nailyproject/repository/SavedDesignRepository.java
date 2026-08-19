package com.example.nailyproject.repository;

import com.example.nailyproject.entity.SavedDesign;
import com.example.nailyproject.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface SavedDesignRepository extends JpaRepository<SavedDesign, Long> {

    @Query("SELECT sd FROM SavedDesign sd " +
            "JOIN FETCH sd.nailDesign nd " +
            "LEFT JOIN FETCH sd.savedFolder sf " +
            "WHERE sd.user = :user " +
            "ORDER BY sd.savedAt DESC")
    List<SavedDesign> findAllByUserWithDetails(@Param("user") User user);
}