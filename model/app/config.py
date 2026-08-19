"""
Naily 서비스 설정값. 전부 환경변수로 오버라이드 가능 (인수인계/배포 시 코드 수정 없이 조정하기 위함).

배포 시 예 (Windows cmd):
    set NAILY_LORA_PATH=D:/models/my_lora_v2.safetensors
    set NAILY_LORA_STRENGTH=0.9
"""

import os
import torch

# ---------------------------------------------------------------------------
# 모델 ID / 경로
# ---------------------------------------------------------------------------
BASE_MODEL_ID = os.environ.get("NAILY_BASE_MODEL_ID", "Tongyi-MAI/Z-Image-Turbo")

# LoRA 파일 경로 - 반드시 실제 서버 환경에 맞게 지정 필요
LORA_PATH = os.environ.get(
    "NAILY_LORA_PATH",
    "C:/2026_SD/ComfyUI_windows_portable/ComfyUI/models/loras/my_first_lora_v1.safetensors",
)
LORA_STRENGTH = float(os.environ.get("NAILY_LORA_STRENGTH", "0.8"))

# ComfyUI SegmentV2 = GroundingDINO(SwinT) + SAM(vit_h) 조합.
# sam_hq_vit_h는 transformers 표준 레포에 없어서 가장 가까운 표준 SAM(vit_h)로 대체.
GROUNDING_DINO_ID = os.environ.get("NAILY_GROUNDING_DINO_ID", "IDEA-Research/grounding-dino-tiny")
SAM_ID = os.environ.get("NAILY_SAM_ID", "facebook/sam-vit-huge")

# ---------------------------------------------------------------------------
# 디바이스 / 정밀도
# ---------------------------------------------------------------------------
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DTYPE = torch.bfloat16 if DEVICE == "cuda" else torch.float32

# VRAM이 빠듯한 GPU(16GB 이하 등)에서만 True로. 여유 있으면 False가 더 빠름.
USE_CPU_OFFLOAD = os.environ.get("NAILY_USE_CPU_OFFLOAD", "true").lower() == "true"

# ---------------------------------------------------------------------------
# 디버그
# ---------------------------------------------------------------------------
DEBUG_SEGMENT_LOG = os.environ.get("NAILY_DEBUG_SEGMENT_LOG", "true").lower() == "true"
DEBUG_SEGMENT_IMAGES = os.environ.get("NAILY_DEBUG_SEGMENT_IMAGES", "false").lower() == "true"

# ---------------------------------------------------------------------------
# 서버 포트 (두 서버로 분리 운영)
# ---------------------------------------------------------------------------
GEN_SERVER_PORT = int(os.environ.get("NAILY_GEN_PORT", "8000"))
DETECT_SERVER_PORT = int(os.environ.get("NAILY_DETECT_PORT", "8001"))
