package com.example.nailyproject.service;

import com.example.nailyproject.entity.NailDesign;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.NailDesignRepository;
import com.example.nailyproject.repository.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.http.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;

import java.util.Map;
import java.util.HashMap;
import java.util.UUID;

@Service
public class NailDesignService {

    private final NailDesignRepository nailDesignRepository;
    private final UserRepository userRepository;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private static final String COMFY_URL = "https://scalded-lard-seduce.ngrok-free.dev";

    public NailDesignService(NailDesignRepository nailDesignRepository, UserRepository userRepository) {
        this.nailDesignRepository = nailDesignRepository;
        this.userRepository = userRepository;
        this.restTemplate = new RestTemplate();
        this.objectMapper = new ObjectMapper();
    }

    private HttpHeaders getHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("ngrok-skip-browser-warning", "true");
        return headers;
    }

    public NailDesign generateDesign(Long userId, String prompt) throws Exception {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found: " + userId));

        String clientId = UUID.randomUUID().toString();
        Map<String, Object> workflow = buildWorkflow(prompt);

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("prompt", workflow);
        requestBody.put("client_id", clientId);

        HttpEntity<Map<String, Object>> request = new HttpEntity<>(requestBody, getHeaders());

        ResponseEntity<String> response = restTemplate.postForEntity(
                COMFY_URL + "/prompt", request, String.class
        );

        JsonNode responseJson = objectMapper.readTree(response.getBody());
        String promptId = responseJson.get("prompt_id").asText();

        String imageUrl = waitForImage(promptId);

        NailDesign design = NailDesign.builder()
                .user(user)
                .imageUrl(imageUrl)
                .promptSummary(prompt)
                .aiModel("z-image-turbo + lora-v1")
                .status(NailDesign.DesignStatus.DRAFT)
                .build();

        return nailDesignRepository.save(design);
    }

    private String waitForImage(String promptId) throws Exception {
        for (int i = 0; i < 60; i++) {
            Thread.sleep(1000);

            HttpEntity<Void> requestEntity = new HttpEntity<>(getHeaders());
            ResponseEntity<String> historyResponse = restTemplate.exchange(
                    COMFY_URL + "/history/" + promptId,
                    HttpMethod.GET,
                    requestEntity,
                    String.class
            );

            JsonNode history = objectMapper.readTree(historyResponse.getBody());

            if (history.has(promptId)) {
                JsonNode outputs = history.get(promptId).get("outputs");
                if (outputs != null && outputs.has("9")) {
                    JsonNode images = outputs.get("9").get("images");
                    if (images != null && images.size() > 0) {
                        String filename = images.get(0).get("filename").asText();
                        return COMFY_URL + "/view?filename=" + filename + "&ngrok-skip-browser-warning=true";
                    }
                }
            }
        }
        throw new RuntimeException("이미지 생성 타임아웃");
    }

    private Map<String, Object> buildWorkflow(String prompt) {
        Map<String, Object> workflow = new HashMap<>();

        workflow.put("3", Map.of(
                "inputs", Map.of(
                        "seed", (long)(Math.random() * Long.MAX_VALUE),
                        "steps", 30,
                        "cfg", 1,
                        "sampler_name", "euler",
                        "scheduler", "simple",
                        "denoise", 1,
                        "model", new Object[]{"19", 0},
                        "positive", new Object[]{"6", 0},
                        "negative", new Object[]{"7", 0},
                        "latent_image", new Object[]{"5", 0}
                ),
                "class_type", "KSampler"
        ));

        workflow.put("4", Map.of(
                "inputs", Map.of("ckpt_name", "z_image\\z_image_turbo_bf16.safetensors"),
                "class_type", "CheckpointLoaderSimple"
        ));

        workflow.put("5", Map.of(
                "inputs", Map.of("width", 768, "height", 512, "batch_size", 1),
                "class_type", "EmptyLatentImage"
        ));

        workflow.put("6", Map.of(
                "inputs", Map.of(
                        "text", prompt,
                        "clip", new Object[]{"16", 0}
                ),
                "class_type", "CLIPTextEncode"
        ));

        workflow.put("7", Map.of(
                "inputs", Map.of(
                        "text", "hands, fingers, skin, blurry, low quality, watermark, text, bad anatomy",
                        "clip", new Object[]{"16", 0}
                ),
                "class_type", "CLIPTextEncode"
        ));

        workflow.put("8", Map.of(
                "inputs", Map.of(
                        "samples", new Object[]{"3", 0},
                        "vae", new Object[]{"14", 0}
                ),
                "class_type", "VAEDecode"
        ));

        workflow.put("9", Map.of(
                "inputs", Map.of(
                        "filename_prefix", "naily",
                        "images", new Object[]{"8", 0}
                ),
                "class_type", "SaveImage"
        ));

        workflow.put("14", Map.of(
                "inputs", Map.of("vae_name", "ae.safetensors"),
                "class_type", "VAELoader"
        ));

        workflow.put("16", Map.of(
                "inputs", Map.of(
                        "clip_name", "z_image\\qwen_3_4b.safetensors",
                        "type", "lumina2",
                        "device", "default"
                ),
                "class_type", "CLIPLoader"
        ));

        workflow.put("19", Map.of(
                "inputs", Map.of(
                        "lora_name", "my_first_lora_v1.safetensors",
                        "strength_model", 0.8,
                        "strength_clip", 1.0,
                        "model", new Object[]{"4", 0},
                        "clip", new Object[]{"4", 1}
                ),
                "class_type", "LoraLoader"
        ));

        return workflow;
    }
}