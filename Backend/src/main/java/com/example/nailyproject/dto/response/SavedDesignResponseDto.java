package com.example.nailyproject.dto.response;

import com.example.nailyproject.entity.SavedDesign;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDateTime;
import java.util.List;

@Getter
@Builder
public class SavedDesignResponseDto {

    private Long designId;
    private List<String> imageUrls;
    private LocalDateTime savedAt;
    private FolderInfo folder;

    @Getter
    @Builder
    public static class FolderInfo {
        private Long folderId;
        private String name;
    }

    public static SavedDesignResponseDto from(SavedDesign savedDesign) {
        FolderInfo folderInfo = null;
        if (savedDesign.getSavedFolder() != null) {
            folderInfo = FolderInfo.builder()
                    .folderId(savedDesign.getSavedFolder().getId())
                    .name(savedDesign.getSavedFolder().getName())
                    .build();
        }

        return SavedDesignResponseDto.builder()
                .designId(savedDesign.getNailDesign().getId())
                .imageUrls(savedDesign.getNailDesign().getImageUrls())
                .savedAt(savedDesign.getSavedAt())
                .folder(folderInfo)
                .build();
    }
}