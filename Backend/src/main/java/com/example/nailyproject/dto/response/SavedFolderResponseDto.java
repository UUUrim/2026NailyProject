package com.example.nailyproject.dto.response;

import lombok.Builder;
import lombok.Getter;

import java.util.List;

@Getter
@Builder
public class SavedFolderResponseDto {
    private Long folderId;
    private String name;
    private Integer sortOrder;
    private Boolean isDefault;
    private String createdAt;
    private String lastSavedAt;
    private int itemCount;
    private List<String> recentImageUrls;
}
