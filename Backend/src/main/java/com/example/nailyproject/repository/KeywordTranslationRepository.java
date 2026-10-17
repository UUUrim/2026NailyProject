package com.example.nailyproject.repository;

import com.example.nailyproject.entity.KeywordTranslation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;

@Repository
public interface KeywordTranslationRepository extends JpaRepository<KeywordTranslation, Long> {

    List<KeywordTranslation> findAllByEnglishIn(Collection<String> englishWords);
}
