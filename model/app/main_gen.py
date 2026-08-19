"""
Naily 이미지 생성 서버 (GPU 필요)

diffusion 모델(Z-Image-Turbo)을 로드해서 실제 이미지를 생성/수정하는 무거운 서버.
파츠 검출/컬러 추출처럼 diffusion이 필요 없는 기능은 main_detect.py(가벼운 서버)에서 처리.

실행:
    uvicorn app.main_gen:app --host 0.0.0.0 --port 8000

외부 노출 (ngrok):
    ngrok http 8000
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app.pipelines import (
    txt2img_generate,
    inpaint_generate,
    image_to_b64,
    b64_to_image,
)

app = FastAPI(title="Naily Generation Service (GPU)")


# ---------------------------------------------------------------------------
# 1. 프롬프트 기반 이미지 생성
# ---------------------------------------------------------------------------
class Txt2ImgRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    seed: int | None = None
    steps: int = 30
    guidance_scale: float = 3
    width: int = 768
    height: int = 512


@app.post("/generate")
def generate(req: Txt2ImgRequest):
    try:
        image = txt2img_generate(
            prompt=req.prompt,
            negative_prompt=req.negative_prompt,
            seed=req.seed,
            steps=req.steps,
            guidance_scale=req.guidance_scale,
            width=req.width,
            height=req.height,
        )
        return {"image_base64": image_to_b64(image)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# 2. 마스크 기반 부분 수정 (텍스트 프롬프트로 자동 마스크 탐지)
# ---------------------------------------------------------------------------
class InpaintRequest(BaseModel):
    image_base64: str
    prompt: str
    mask_prompt: str | None = None
    mask_base64: str | None = None
    seed: int | None = None
    steps: int = 30
    strength: float = 0.8
    guidance_scale: float = 3
    threshold: float = 0.35
    mask_offset: int = 8
    grow_mask_by: int = 20


@app.post("/inpaint")
def inpaint(req: InpaintRequest):
    if not req.mask_prompt and not req.mask_base64:
        raise HTTPException(
            status_code=400,
            detail="mask_prompt(자동 탐지) 또는 mask_base64(수동 마스크) 중 하나는 필요합니다.",
        )
    try:
        image = b64_to_image(req.image_base64).convert("RGB")
        mask_image = b64_to_image(req.mask_base64).convert("L") if req.mask_base64 else None

        result = inpaint_generate(
            image=image,
            prompt=req.prompt,
            mask_prompt=req.mask_prompt or "",
            mask_image=mask_image,
            seed=req.seed,
            steps=req.steps,
            strength=req.strength,
            guidance_scale=req.guidance_scale,
            threshold=req.threshold,
            mask_offset=req.mask_offset,
            grow_mask_by=req.grow_mask_by,
        )
        return {"image_base64": image_to_b64(result)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
def health():
    return {"status": "ok", "service": "generation"}
