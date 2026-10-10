package com.example.nailyproject.dto.request;

import com.example.nailyproject.entity.HandScan;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class ScanStartRequestDto {

    @NotNull(message = "손 방향 값이 올바르지 않습니다.")
    private HandScan.HandSide handSide; // LEFT or RIGHT

    // 같은 스캔에서 이미 찍은 반대 손의 scanId (두 번째 손을 시작할 때만 보낸다). 없으면 짝 없이 시작한다.
    private Long pairedScanId;
}