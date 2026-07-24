package com.example.nailyproject.service;

import com.example.nailyproject.dto.response.SavedDesignResponseDto;
import com.example.nailyproject.entity.NailDesign;
import com.example.nailyproject.entity.SavedDesign;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.NailDesignRepository;
import com.example.nailyproject.repository.SavedDesignRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class SavedDesignService {

    private final SavedDesignRepository savedDesignRepository;
    private final NailDesignRepository nailDesignRepository;

    // 1. 찜하기 (하트 채우기)
    @Transactional
    public void addLike(User user, Long designId, String imageUrl) {
        NailDesign design = nailDesignRepository.findById(designId)
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 디자인입니다."));

        if (savedDesignRepository.existsByUserAndNailDesignAndImageUrl(user, design, imageUrl)) {
            throw new IllegalArgumentException("이미 찜한 디자인입니다.");
        }

        SavedDesign savedDesign = SavedDesign.builder()
                .user(user)
                .nailDesign(design)
                .imageUrl(imageUrl)
                // 폴더 기능이 추가된다면 여기에 savedFolder를 연결해주면 됩니다!
                .build();

        savedDesignRepository.save(savedDesign);
    }

    // 2. 찜 취소 (하트 비우기)
    @Transactional
    public void removeLike(User user, Long designId, String imageUrl) {
        NailDesign design = nailDesignRepository.findById(designId)
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 디자인입니다."));

        SavedDesign savedDesign = savedDesignRepository.findByUserAndNailDesignAndImageUrl(user, design, imageUrl)
                .orElseThrow(() -> new IllegalArgumentException("찜한 내역이 없습니다."));

        savedDesignRepository.delete(savedDesign);
    }

    // 3. 찜 목록 전체 조회
    @Transactional(readOnly = true)
    public List<SavedDesignResponseDto> getSavedDesigns(User user) {
        List<SavedDesign> savedList = savedDesignRepository.findAllByUserIdOrderBySavedAtDesc(user.getId());

        //  .from() 써서 리스트를 싹 다 변환
        return savedList.stream()
                .map(SavedDesignResponseDto::from)
                .collect(Collectors.toList());
    }
}