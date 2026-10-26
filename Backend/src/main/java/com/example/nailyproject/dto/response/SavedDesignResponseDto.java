package com.example.nailyproject.dto.response;

import com.example.nailyproject.entity.SavedDesign;
import lombok.Builder;
import lombok.Getter;

import java.time.format.DateTimeFormatter;

//이걸 찜목록 불러오기용으로

@Getter
@Builder
public class SavedDesignResponseDto {

    // community가 false면 내 로컬 DB의 디자인 id, true면 갤러리 DB id(다른 로컬 DB 사용자가 공유한 디자인)
    private Long designId;
    private boolean community;
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

        boolean community = savedDesign.getNailDesign() == null;
        return SavedDesignResponseDto.builder()
                .designId(community ? savedDesign.getCommunityDesignId() : savedDesign.getNailDesign().getId())
                .community(community)
                .imageUrl(savedDesign.getImageUrl())
                .savedAt(savedDesign.getSavedAt() != null ? savedDesign.getSavedAt().format(FORMATTER) : "")
                .folder(folderInfo)
                .build();
    }
}
