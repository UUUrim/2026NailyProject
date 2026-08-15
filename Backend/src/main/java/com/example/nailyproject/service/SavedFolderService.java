package com.example.nailyproject.service;

import com.example.nailyproject.dto.response.SavedFolderResponseDto;
import com.example.nailyproject.entity.SavedDesign;
import com.example.nailyproject.entity.SavedFolder;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.SavedDesignRepository;
import com.example.nailyproject.repository.SavedFolderRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class SavedFolderService {

    public static final String DEFAULT_FOLDER_NAME = "기본";

    private final SavedFolderRepository savedFolderRepository;
    private final SavedDesignRepository savedDesignRepository;

    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("yyyy. M. d. HH:mm:ss");

    @Transactional
    public List<SavedFolderResponseDto> getMyFolders(User user) {
        ensureDefaultFolder(user);
        List<SavedFolder> folders = savedFolderRepository.findAllByUserOrderBySortOrderAscCreatedAtAsc(user);
        List<SavedDesign> allSaved = savedDesignRepository.findAllByUserIdOrderBySavedAtDesc(user.getId());

        return folders.stream()
                .map(folder -> toDto(folder, allSaved))
                .collect(Collectors.toList());
    }

    @Transactional
    public SavedFolder ensureDefaultFolder(User user) {
        SavedFolder defaultFolder = resolveDefaultFolder(user);

        List<SavedDesign> orphans = savedDesignRepository.findAllByUserIdOrderBySavedAtDesc(user.getId()).stream()
                .filter(d -> d.getSavedFolder() == null)
                .collect(Collectors.toList());
        for (SavedDesign orphan : orphans) {
            orphan.updateSavedFolder(defaultFolder);
        }
        return defaultFolder;
    }

    /**
     * 기본 폴더를 찾되, 과거 동시 요청(레이스 컨디션)으로 인해
     * defaultFolder=true 인 행이 2개 이상 존재하는 경우를 자동으로 복구한다.
     * - 가장 먼저 생성된(id가 가장 작은) 폴더만 기본 폴더로 남기고
     * - 나머지 중복 기본 폴더는 일반 폴더로 강등한 뒤, 그 안의 찜 항목들을 남긴 기본 폴더로 이동시킨다.
     */
    private SavedFolder resolveDefaultFolder(User user) {
        List<SavedFolder> defaults = savedFolderRepository.findAllByUserAndDefaultFolderTrue(user);

        if (!defaults.isEmpty()) {
            SavedFolder primary = defaults.stream()
                    .min(Comparator.comparing(SavedFolder::getId))
                    .orElseThrow();

            for (SavedFolder duplicate : defaults) {
                if (duplicate.getId().equals(primary.getId())) continue;
                duplicate.unmarkAsDefault();
                mergeFolderInto(user, duplicate, primary);
            }
            return primary;
        }

        return savedFolderRepository.findByUserAndName(user, DEFAULT_FOLDER_NAME)
                .map(folder -> {
                    folder.markAsDefault();
                    return folder;
                })
                .orElseGet(() -> savedFolderRepository.save(SavedFolder.builder()
                        .user(user)
                        .name(DEFAULT_FOLDER_NAME)
                        .sortOrder(0)
                        .defaultFolder(true)
                        .build()));
    }

    /** source 폴더에 들어있던 찜 항목들을 target 폴더로 옮긴다. (데이터 유실 방지용 병합) */
    private void mergeFolderInto(User user, SavedFolder source, SavedFolder target) {
        List<SavedDesign> items = savedDesignRepository.findAllByUserIdOrderBySavedAtDesc(user.getId()).stream()
                .filter(d -> d.getSavedFolder() != null && d.getSavedFolder().getId().equals(source.getId()))
                .collect(Collectors.toList());
        for (SavedDesign item : items) {
            item.updateSavedFolder(target);
        }
    }

    @Transactional
    public SavedFolder createFolderEntity(User user, String name) {
        String trimmed = name == null ? "" : name.trim();
        if (trimmed.isEmpty()) {
            throw new IllegalArgumentException("폴더 이름을 입력해 주세요.");
        }
        if (trimmed.length() > 50) {
            throw new IllegalArgumentException("폴더 이름은 50자 이하여야 합니다.");
        }

        Integer max = savedFolderRepository.findMaxSortOrderByUser(user);
        int nextOrder = (max == null ? -1 : max) + 1;

        SavedFolder folder = SavedFolder.builder()
                .user(user)
                .name(trimmed)
                .sortOrder(nextOrder)
                .defaultFolder(false)
                .build();
        return savedFolderRepository.save(folder);
    }

    @Transactional
    public SavedFolderResponseDto createFolder(User user, String name) {
        ensureDefaultFolder(user);
        SavedFolder saved = createFolderEntity(user, name);
        return toDto(saved, List.of());
    }

    /**
     * 폴더 삭제. 기본 폴더는 삭제할 수 없으며,
     * 삭제되는 폴더 안에 있던 찜 이미지는 자동으로 기본 폴더로 이동시킨 뒤 폴더를 제거한다.
     */
    @Transactional
    public void deleteFolder(User user, Long folderId) {
        SavedFolder folder = savedFolderRepository.findByIdAndUser(folderId, user)
                .orElseThrow(() -> new IllegalArgumentException("폴더를 찾을 수 없습니다."));

        if (folder.isDefaultFolder()) {
            throw new IllegalArgumentException("기본 폴더는 삭제할 수 없습니다.");
        }

        SavedFolder defaultFolder = resolveDefaultFolder(user);
        mergeFolderInto(user, folder, defaultFolder);
        savedFolderRepository.delete(folder);
    }

    @Transactional
    public void reorderFolders(User user, List<Long> folderIds) {
        if (folderIds == null || folderIds.isEmpty()) return;
        List<SavedFolder> folders = savedFolderRepository.findAllByUserOrderBySortOrderAscCreatedAtAsc(user);
        for (int i = 0; i < folderIds.size(); i++) {
            Long id = folderIds.get(i);
            final int order = i;
            folders.stream()
                    .filter(f -> f.getId().equals(id))
                    .findFirst()
                    .ifPresent(f -> f.updateSortOrder(order));
        }
    }

    private SavedFolderResponseDto toDto(SavedFolder folder, List<SavedDesign> allSaved) {
        List<SavedDesign> inFolder = allSaved.stream()
                .filter(d -> d.getSavedFolder() != null && d.getSavedFolder().getId().equals(folder.getId()))
                .sorted(Comparator.comparing(SavedDesign::getSavedAt, Comparator.nullsLast(Comparator.reverseOrder())))
                .collect(Collectors.toList());

        List<String> recent = inFolder.stream()
                .limit(3)
                .map(SavedDesign::getImageUrl)
                .collect(Collectors.toList());

        LocalDateTime lastSaved = inFolder.isEmpty() ? null : inFolder.get(0).getSavedAt();

        return SavedFolderResponseDto.builder()
                .folderId(folder.getId())
                .name(folder.getName())
                .sortOrder(folder.getSortOrder())
                .isDefault(folder.isDefaultFolder())
                .createdAt(folder.getCreatedAt() != null ? folder.getCreatedAt().format(FORMATTER) : "")
                .lastSavedAt(lastSaved != null ? lastSaved.format(FORMATTER) : null)
                .itemCount(inFolder.size())
                .recentImageUrls(recent.isEmpty() ? new ArrayList<>() : recent)
                .build();
    }
}