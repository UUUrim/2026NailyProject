"""
slice_and_print.py
--------------------
병합된 3MF를 슬라이싱(OrcaSlicer CLI)하고, 결과 G-code를 Bambu Lab 프린터에
업로드해서 출력을 시작시킨다.

[반드시 채워야 하는 설정값 - CONFIG 섹션]
- ORCASLICER_PATH: OrcaSlicer CLI 실행 파일 경로
- PRINT_PROFILE_*: 사용 중인 프린터/필라멘트/공정 프로파일(.ini 또는 .json) 경로
  (OrcaSlicer에서 "프로파일 내보내기"로 뽑을 수 있음)
- PRINTER_IP / PRINTER_ACCESS_CODE / PRINTER_SERIAL: Bambu Studio 앱의
  "설정 > 프린터" 화면에서 확인 가능 (LAN 모드로 켜져 있어야 함)

[중요] bambulabs_api 라이브러리는 버전에 따라 메서드 이름/시그니처가 다를 수 있다.
아래 코드는 일반적으로 쓰이는 패턴(연결 -> 파일 업로드 -> 출력 시작)을 따랐지만,
실제 설치된 버전 문서(pip show bambulabs_api, 또는 GitHub 저장소)를 보고
메서드명이 다르면 맞춰서 고쳐야 한다.
"""

import os
import subprocess
import time

# ---------------------------------------------------------------------------
# CONFIG — 실제 환경에 맞게 채워 넣을 것
# ---------------------------------------------------------------------------

BASE = os.path.dirname(os.path.abspath(__file__))

# OrcaSlicer 실행 파일 경로 (GUI용 exe 하나뿐 — 명령줄 인자를 주면 자동으로 CLI 모드로 동작함)
ORCASLICER_PATH = r"C:\Program Files\OrcaSlicer\orca-slicer.exe"

# 슬라이싱에 쓸 프로파일. GUI로 "내보내기"한 커스텀 파일 대신, OrcaSlicer 설치 폴더 안에
# 이미 있는 내장 시스템 프로파일을 직접 가리킨다. 내보내기한 파일은 "type" 필드가 빠져있어
# CLI가 "unknown config type"으로 거부하는 문제가 있었는데, 이 내장 파일들은 "type": "process"가
# 이미 포함된 완결된 프리셋이라 이 문제가 없다.
_ORCASLICER_RESOURCES = r"C:\Program Files\OrcaSlicer\resources\profiles\BBL"
PRINT_PROFILE_MACHINE = _ORCASLICER_RESOURCES + r"\machine\Bambu Lab A1 0.4 nozzle.json"
_BASE_PROCESS_PROFILE = _ORCASLICER_RESOURCES + r"\process\0.12mm High Quality @BBL A1.json"
PRINT_PROFILE_FILAMENT = _ORCASLICER_RESOURCES + r"\filament\Bambu PETG Translucent @BBL A1.json"

# 네일팁용 서포트 오버라이드. 내장 기본 프로파일엔 이 값들이 아예 없는데, 그러면 CLI가
# "서포트 필요성 자동 판단" 단계에서 우리 모델(작고 심하게 기울어진 형태)에 대해 비정상적으로
# 큰 값을 계산하다가 "found slicing or export error"로 조용히 죽는 버그가 있었다.
# GUI에서는 같은 파일로도 죽지 않는 걸 보면 CLI(헤드리스) 전용 버그로 보인다.
SUPPORT_OVERRIDES = {
    "enable_support": "1",
    "support_threshold_angle": "30",
    "brim_type": "outer_only",
    "brim_width": "3",
    "curr_bed_type": "Textured PEI Plate",
}

FILAMENT_OVERRIDES = {
    "textured_plate_temp": ["75"],
    "textured_plate_temp_initial_layer": ["75"],
    "nozzle_temperature": ["230"],
    "nozzle_temperature_initial_layer": ["230"],
    "filament_retraction_length": ["0.5"],
}


def _build_patched_process_profile(output_dir: str) -> str:
    """내장 process 프로파일을 읽어서 SUPPORT_OVERRIDES를 덮어쓴 임시 파일을 만든다.
    매 슬라이싱 요청마다 새로 만들어서 output_dir 안에 저장 (서로 다른 요청끼리 안 겹치게)."""
    import json

    with open(_BASE_PROCESS_PROFILE, encoding="utf-8") as f:
        data = json.load(f)
    data.update(SUPPORT_OVERRIDES)

    os.makedirs(output_dir, exist_ok=True)
    patched_path = os.path.join(output_dir, "process_patched.json")
    with open(patched_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=8, ensure_ascii=False)

    return patched_path

def _build_patched_filament_profile(output_dir: str) -> str:
    import json
    with open(PRINT_PROFILE_FILAMENT, encoding="utf-8") as f:
        data = json.load(f)
    data.update(FILAMENT_OVERRIDES)
    os.makedirs(output_dir, exist_ok=True)
    patched_path = os.path.join(output_dir, "filament_patched.json")
    with open(patched_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=8, ensure_ascii=False)
    return patched_path

# 프린터 연결 정보 (Bambu Studio 앱 > 설정 > 프린터에서 확인)
# 프린터 연결 정보 (Bambu Studio 앱 > 설정 > 프린터에서 확인)
# 실제 값은 절대 이 파일에 직접 적지 않는다 — .env 파일(printer/.env, git에 안 올라감)에서 읽어온다.
def _load_env():
    env_path = os.path.join(BASE, ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip())


_load_env()

PRINTER_IP = os.environ.get("PRINTER_IP", "")
PRINTER_ACCESS_CODE = os.environ.get("PRINTER_ACCESS_CODE", "")
PRINTER_SERIAL = os.environ.get("PRINTER_SERIAL", "")

# ---------------------------------------------------------------------------


def slice_3mf(input_3mf_path: str, output_dir: str) -> str:
    """
    OrcaSlicer CLI로 3MF를 슬라이싱해서 G-code(.gcode.3mf)를 만든다.
    반환값: 생성된 gcode 파일의 경로.
    """
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "sliced.gcode.3mf")

    process_profile = _build_patched_process_profile(output_dir)
    filament_profile = _build_patched_filament_profile(output_dir)

    cmd = [
        ORCASLICER_PATH,
        "--slice", "0",              # 0 = 플레이트 전체 슬라이싱
        "--arrange", "0",
        "--load-settings", f"{PRINT_PROFILE_MACHINE};{process_profile}",
        "--load-filaments", filament_profile,
        "--export-3mf", output_path,
        input_3mf_path,
    ]

    print(f"[Slice] Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        raise RuntimeError(
            f"슬라이싱 실패 (returncode={result.returncode}):\n"
            f"--- stdout ---\n{result.stdout[-1500:]}\n"
            f"--- stderr ---\n{result.stderr[-1500:]}"
        )
    if not os.path.exists(output_path):
        raise RuntimeError(f"슬라이싱은 성공했다는데 결과 파일이 없습니다: {output_path}")

    print(f"[Slice] 완료: {output_path}")
    return output_path


def upload_and_print(gcode_path: str, plate_number: int = 1) -> None:
    """
    슬라이싱된 G-code를 프린터에 업로드하고 출력을 시작시킨다.
    bambulabs_api를 사용 (FTP로 업로드 후 MQTT로 출력 명령).
    """
    from bambulabs_api import Printer  # 지연 임포트: 이 함수를 안 쓰면 의존성 없어도 되게

    printer = Printer(PRINTER_IP, PRINTER_ACCESS_CODE, PRINTER_SERIAL)
    printer.connect()

    try:
        # 프린터가 연결/준비될 때까지 잠깐 대기 (MQTT 핸드셰이크 시간)
        time.sleep(2)

        print(f"[Print] 파일 업로드 중: {gcode_path}")
        remote_filename = os.path.basename(gcode_path)
        with open(gcode_path, "rb") as f:
            printer.upload_file(f, remote_filename)

        print(f"[Print] 출력 시작: {remote_filename}")
        printer.start_print(remote_filename, plate_number, use_ams=False)

        print("[Print] 출력 명령 전송 완료.")
    finally:
        printer.disconnect()


def slice_and_send_to_printer(merged_3mf_path: str, output_dir: str) -> str:
    """
    병합된 3MF -> 슬라이싱 -> 프린터 업로드/출력 시작까지 한 번에 처리.
    반환값: 슬라이싱된 gcode 파일 경로 (S3 백업 업로드 등에 재사용 가능).
    """
    gcode_path = slice_3mf(merged_3mf_path, output_dir)
    upload_and_print(gcode_path)
    return gcode_path