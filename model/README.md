# 🔨 AI 이미지 생성 연동

## 작업 내용
Z-Image Turbo + LoRA 모델을 ComfyUI API를 통해 Spring Boot에 연동하여 네일 디자인 이미지를 생성하고 DB에 저장하는 기능

---

## 아키텍처
```
[클라이언트]
     │ POST /api/designs/generate
     ▼
[Spring Boot :8080]
     │ ComfyUI 워크플로우 JSON 전송
     ▼
[ComfyUI :8188]
     │ Z-Image Turbo + LoRA로 이미지 생성
     ▼
[MySQL naily_db] — nail_designs 테이블 저장
```


## 새로 추가한 파일

| 파일 | 설명 |
|------|------|
| `src/main/java/.../repository/NailDesignRepository.java` | nail_designs 테이블 DB 접근 |
| `src/main/java/.../service/NailDesignService.java` | ComfyUI API 호출 및 이미지 생성 로직 |
| `src/main/java/.../controller/NailDesignController.java` | 이미지 생성 API 엔드포인트 |

---

## 수정한 파일

| 파일 | 수정 내용                                                      |
|------|------------------------------------------------------------|
| `entity/NailDesign.java` | image_url 컬럼 길이 50 → 500                       |
| `auth/SecurityConfig.java` | `/api/designs/**` 인증 없이 접근 가능하도록 추가 (테스트하려고 추가한거라 이후 수정 필요) |

---

## API 명세서

### 네일 디자인 이미지 생성
POST /api/designs/generate

**Request Body**
```json
{
    "userId": 1,
    "prompt": "nailart, almond nail tips, glitter nail art, #FFB6C1, lovely mood, korean nail art style, product shot, white background, no hands"
}
```

**Response**
```json
{
    "id": 1,
    "user": { ... },
    "imageUrl": "https://xxxx.ngrok-free.dev/view?filename=naily_00001_.png",
    "promptSummary": "nailart, almond nail tips, ...",
    "aiModel": "z-image-turbo + lora-v1",
    "status": "DRAFT",
    "generatedAt": "2026-05-25T03:25:17"
}
```

---

## 실행 방법

## 실행 방법

### 나
1. ComfyUI 실행 (`run_nvidia_gpu.bat` — `--listen 0.0.0.0 --port 8188` 옵션 필요)
2. ngrok 실행: `ngrok http 8188`
3. 생성된 ngrok 주소를 팀원들에게 공유

### 팀원 공통
1. `NailDesignService.java`에서 ComfyUI URL을 공유받은 ngrok 주소로 변경 (기본적으로 작성되어있음)
```java
   private static final String COMFY_URL = "https://xxxx.ngrok-free.dev";
```
2. `application-key.yml` 생성
3. Spring Boot 실행

