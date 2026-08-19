"""
Naily 검출 서버 (diffusion 모델 불필요, 상대적으로 가벼움)

GroundingDINO + SAM만 사용해서 파츠 검출, 손톱별 컬러 추출을 처리하는 서버.
Z-Image 같은 무거운 diffusion 모델을 로드하지 않아서, main_gen.py보다 훨씬 가볍게
돌아갑니다. GPU 없이 CPU만으로도 동작은 하지만(느림), 약한 GPU 정도면 충분합니다.

main_gen.py(생성 서버)와 별도 컴퓨터에서 동시에 띄우면, 생성이 진행되는 동안
검출을 병렬로 처리할 수 있어 전체 처리 시간을 줄일 수 있습니다.

실행:
    uvicorn app.main_detect:app --host 0.0.0.0 --port 8001

외부 노출 (ngrok):
    ngrok http 8001
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.pipelines import (
    separate_parts,
    extract_colors_per_nail,
    image_to_b64,
    b64_to_image,
)

app = FastAPI(title="Naily Detection Service (GroundingDINO + SAM)")


# ---------------------------------------------------------------------------
# 1. 파츠 검출 + 인스턴스 분리
# ---------------------------------------------------------------------------
class PartsRequest(BaseModel):
    image_base64: str
    parts: list[str] = Field(default_factory=lambda: ["bow on nail tip"])
    threshold: float = 0.4


@app.post("/parts")
def parts(req: PartsRequest):
    try:
        image = b64_to_image(req.image_base64).convert("RGB")
        results = separate_parts(image, req.parts, threshold=req.threshold)
        return {
            phrase: [image_to_b64(crop, fmt="PNG") for crop in crops]
            for phrase, crops in results.items()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# 2. 손톱별 컬러 추출 (그라데이션/프렌치 대응)
# ---------------------------------------------------------------------------
class ColorsPerNailRequest(BaseModel):
    image_base64: str
    segment_prompt: str = "nail tip"
    threshold: float = 0.35
    mask_shrink: int = 6
    min_area: int = 200
    color_diff_threshold: float = 40.0


@app.post("/colors_per_nail")
def colors_per_nail(req: ColorsPerNailRequest):
    try:
        image = b64_to_image(req.image_base64).convert("RGB")
        result = extract_colors_per_nail(
            image,
            segment_prompt=req.segment_prompt,
            threshold=req.threshold,
            mask_shrink=req.mask_shrink,
            min_area=req.min_area,
            color_diff_threshold=req.color_diff_threshold,
        )
        return {"nails": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
def health():
    return {"status": "ok", "service": "detection"}
