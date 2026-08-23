package com.example.nailyproject.service;

import com.example.nailyproject.dto.response.SavedDesignResponseDto;
import com.example.nailyproject.entity.NailDesign;
import com.example.nailyproject.entity.SavedDesign;
import com.example.nailyproject.entity.SavedFolder;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.NailDesignRepository;
import com.example.nailyproject.repository.SavedDesignRepository;
import com.example.nailyproject.repository.SavedFolderRepository;
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
    private final SavedFolderRepository savedFolderRepository;
    private final SavedFolderService savedFolderService;

    @Transactional
    public SavedDesignResponseDto addLike(User user, Long designId, String imageUrl, Long folderId, String newFolderName) {
        NailDesign design = nailDesignRepository.findById(designId)
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 디자인입니다."));

        if (savedDesignRepository.existsByUserAndNailDesignAndImageUrl(user, design, imageUrl)) {
            throw new IllegalArgumentException("이미 찜한 디자인입니다.");
        }

        SavedFolder folder = resolveFolder(user, folderId, newFolderName);

        SavedDesign savedDesign = SavedDesign.builder()
                .user(user)
                .nailDesign(design)
                .imageUrl(imageUrl)
                .savedFolder(folder)
                .build();

        SavedDesign saved = savedDesignRepository.save(savedDesign);
        return SavedDesignResponseDto.from(saved);
    }

    @Transactional
    public SavedDesignResponseDto moveLike(User user, Long designId, String imageUrl, Long folderId, String newFolderName) {
        NailDesign design = nailDesignRepository.findById(designId)
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 디자인입니다."));

        SavedDesign savedDesign = savedDesignRepository.findByUserAndNailDesignAndImageUrl(user, design, imageUrl)
                .orElseThrow(() -> new IllegalArgumentException("찜한 내역이 없습니다."));

        SavedFolder folder = resolveFolder(user, folderId, newFolderName);
        savedDesign.updateSavedFolder(folder);
        return SavedDesignResponseDto.from(savedDesign);
    }

    @Transactional
    public void removeLike(User user, Long designId, String imageUrl) {
        NailDesign design = nailDesignRepository.findById(designId)
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 디자인입니다."));

        SavedDesign savedDesign = savedDesignRepository.findByUserAndNailDesignAndImageUrl(user, design, imageUrl)
                .orElseThrow(() -> new IllegalArgumentException("찜한 내역이 없습니다."));

        savedDesignRepository.delete(savedDesign);
    }

    @Transactional
    public List<SavedDesignResponseDto> getSavedDesigns(User user) {
        savedFolderService.ensureDefaultFolder(user);
        List<SavedDesign> savedList = savedDesignRepository.findAllByUserIdOrderBySavedAtDesc(user.getId());
        return savedList.stream()
                .map(SavedDesignResponseDto::from)
                .collect(Collectors.toList());
    }

    private SavedFolder resolveFolder(User user, Long folderId, String newFolderName) {
        if (newFolderName != null && !newFolderName.isBlank()) {
            savedFolderService.ensureDefaultFolder(user);
            return savedFolderService.createFolderEntity(user, newFolderName);
        }
        if (folderId != null) {
            return savedFolderRepository.findByIdAndUser(folderId, user)
                    .orElseThrow(() -> new IllegalArgumentException("폴더를 찾을 수 없습니다."));
        }
        return savedFolderService.ensureDefaultFolder(user);
    }
}
