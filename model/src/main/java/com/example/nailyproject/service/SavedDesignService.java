package com.example.nailyproject.service;

import com.example.nailyproject.dto.response.SavedDesignResponseDto;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.SavedDesignRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class SavedDesignService {

    private final SavedDesignRepository savedDesignRepository;

    /**
     * 저장 디자인 전체 목록 조회
     */
    public List<SavedDesignResponseDto> getSavedDesigns(User user) {
        return savedDesignRepository.findAllByUserWithDetails(user)
                .stream()
                .map(SavedDesignResponseDto::from)
                .collect(Collectors.toList());
    }
}