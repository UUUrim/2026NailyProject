package com.example.nailyproject.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.ArrayList;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class SlotData {
    private List<String> liked = new ArrayList<>();
    private List<String> disliked = new ArrayList<>();
}

