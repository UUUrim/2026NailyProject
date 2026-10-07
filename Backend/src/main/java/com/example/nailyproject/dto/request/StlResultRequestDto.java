package com.example.nailyproject.dto.request;

import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.List;

@Getter
@NoArgsConstructor
public class StlResultRequestDto {

    // 파이썬 STL 생성 파이프라인이 실패하면 {"success": false, "message": ...}만 보낸다.
    // (예전 버전 호환: success가 아예 없으면 fingers 유무로 판단)
    private Boolean success;
    private String message;

    private List<StlFingerResult> fingers; // 손가락별 STL 결과 (이번에 실제로 생성된 손가락만)

    public boolean isFailed() {
        return Boolean.FALSE.equals(success) || fingers == null || fingers.isEmpty();
    }

    @Getter
    @NoArgsConstructor
    public static class StlFingerResult {
        private String finger;  // THUMB, INDEX ...
        private String stlUrl;  // 완성된 3D 파일의 로컬 경로(S3에 올리지 않음)
    }
}