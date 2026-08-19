package com.example.nailyproject.dto.response;

import com.example.nailyproject.entity.SavedDesign;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDateTime;

@Getter
@Builder
public class SavedDesignResponseDto {

    private Long designId;
    private String imageUrl;
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
                .imageUrl(savedDesign.getNailDesign().getImageUrl())
                .savedAt(savedDesign.getSavedAt())
                .folder(folderInfo)
                .build();
    }
}