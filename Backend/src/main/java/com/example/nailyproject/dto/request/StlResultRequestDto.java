package com.example.nailyproject.dto.request;

import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.List;

@Getter
@NoArgsConstructor
public class StlResultRequestDto {

    private List<StlFingerResult> fingers; // 손가락별 STL 결과

    @Getter
    @NoArgsConstructor
    public static class StlFingerResult {
        private String finger;  // THUMB, INDEX ...
        private String stlUrl;  // 완성된 3D 파일 S3 주소
    }
}