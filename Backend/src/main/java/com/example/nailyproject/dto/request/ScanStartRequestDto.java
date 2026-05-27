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
}