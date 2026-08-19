package com.example.nailyproject.controller;

import com.example.nailyproject.entity.NailDesign;
import com.example.nailyproject.service.NailDesignService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/designs")
public class NailDesignController {

    private final NailDesignService nailDesignService;

    public NailDesignController(NailDesignService nailDesignService) {
        this.nailDesignService = nailDesignService;
    }

    @PostMapping("/generate")
    public ResponseEntity<NailDesign> generate(@RequestBody Map<String, Object> body) throws Exception {
        Long userId = Long.valueOf(body.get("userId").toString());
        String prompt = body.get("prompt").toString();
        NailDesign design = nailDesignService.generateDesign(userId, prompt);
        return ResponseEntity.ok(design);
    }
}