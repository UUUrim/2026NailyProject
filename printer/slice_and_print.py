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

# 슬라이싱에 쓸 프로파일 (OrcaSlicer에서 내보낸 프로파일 경로)
# 파일명은 영어로 유지할 것 — 한글 파일명이 명령줄 인자로 넘어갈 때 인코딩 깨짐 문제가 있었음
PRINT_PROFILE_MACHINE = os.path.join(BASE, "profiles", "bambu_a1_machine.json")
PRINT_PROFILE_PROCESS = os.path.join(BASE, "profiles", "nail_tip_process.json")
PRINT_PROFILE_FILAMENT = os.path.join(BASE, "profiles", "filament.json")

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

    cmd = [
        ORCASLICER_PATH,
        "--slice", "0",              # 0 = 플레이트 전체 슬라이싱
        "--load-settings", f"{PRINT_PROFILE_MACHINE};{PRINT_PROFILE_PROCESS}",
        "--load-filaments", PRINT_PROFILE_FILAMENT,
        "--export-3mf", output_path,
        input_3mf_path,
    ]

    print(f"[Slice] Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        raise RuntimeError(f"슬라이싱 실패:\n{result.stderr[-1000:]}")
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