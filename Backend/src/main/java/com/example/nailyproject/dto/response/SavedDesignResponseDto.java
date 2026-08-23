package com.example.nailyproject.dto.response;

import com.example.nailyproject.entity.SavedDesign;
import lombok.Builder;
import lombok.Getter;

import java.time.format.DateTimeFormatter;

//이걸 찜목록 불러오기용으로

@Getter
@Builder
public class SavedDesignResponseDto {

    private Long designId;
    private String imageUrl;
    private String savedAt; // yyyy. M. d. HH:mm:ss
    private FolderInfo folder;

    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("yyyy. M. d. HH:mm:ss");

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
                .imageUrl(savedDesign.getImageUrl())
                .savedAt(savedDesign.getSavedAt() != null ? savedDesign.getSavedAt().format(FORMATTER) : "")
                .folder(folderInfo)
                .build();
    }
}
