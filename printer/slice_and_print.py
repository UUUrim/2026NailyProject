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
PRINT_PROFILE_MACHINE = _ORCASLICER_RESOURCES + r"\machine\Bambu Lab A1 0.2 nozzle.json"
_BASE_PROCESS_PROFILE = _ORCASLICER_RESOURCES + r"\process\0.10mm High Quality @BBL A1 0.2 nozzle.json"
PRINT_PROFILE_FILAMENT = _ORCASLICER_RESOURCES + r"\filament\Bambu PETG Translucent @BBL A1 0.2 nozzle.json"

# 네일팁용 서포트 오버라이드. 내장 기본 프로파일엔 이 값들이 아예 없는데, 그러면 CLI가
# "서포트 필요성 자동 판단" 단계에서 우리 모델(작고 심하게 기울어진 형태)에 대해 비정상적으로
# 큰 값을 계산하다가 "found slicing or export error"로 조용히 죽는 버그가 있었다.
# GUI에서는 같은 파일로도 죽지 않는 걸 보면 CLI(헤드리스) 전용 버그로 보인다.
SUPPORT_OVERRIDES = {
    "enable_support": "1",     #서포트를 꼭 필요한 곳에만 만든다 => 슬라이서가 "꼭 필요하다"고 판단하는 기준이 꽤 엄격하다고 함
    "support_threshold_angle": "50",        # 값이 클수록 서포트가 더 많이 생긴다 (30 -> 55: 네일팁 밑면이 서포트를 못 받던 문제)
    "support_remove_small_overhang": "0",   # 기본값(1)은 "작은 돌출은 서포트 대상에서 뺀다": 우리 모델은 서포트가 필요한 면적이 0.55mm²로 작아서 통째로 무시될 수 있다
    "support_on_build_plate_only": "0",     # 1이면 바닥까지 곧바로 못 내려가는 자리는 서포트를 지운다: 이 모양은 서포트 필요 자리가 전부 손톱 아래층 0.7mm 안이라 서포트가 사라졌다
    "support_top_z_distance": "0.24",       # 0.12 -> 0.24(2층): PETG는 서포트와 잘 녹아붙어서 간격을 벌려 쉽게 떼게 한다
    "support_object_xy_distance": "0.2",    # 서포트와 출력물 옆면 사이 간격 (기본 0.35). 0.4 -> 0.2: 큐티클 쪽 손톱 끝과 서포트가 0.7mm 떨어져 받치지 못해서 가깝게. 너무 붙으면 떼기 어렵다
    "support_interface_top_layers": "1",    # 2 -> 1: 출력물에 닿는 촘촘한 접촉층을 한 겹만 (덜 붙는다)
    "support_interface_spacing": "0.4",     # 접촉층 선 간격: 넓을수록 덜 붙는다
    "support_type": "tree(auto)",
    "support_style": "tree_slim",
    # 네일팁은 작아서(약 15mm) 기본 굵기의 가지/기둥이면 원통처럼 보인다. 가지를 가늘게, 더 촘촘하게.
    "tree_support_branch_diameter": "4",  # 기본 5 -> 2.5: 기둥 굵기
    "tree_support_tip_diameter": "0.6",      # 출력물에 닿는 끝 지름 (0.8 -> 0.6: 닿는 면이 작아서 쉽게 떨어진다)
    "tree_support_branch_distance": "5",   # 가지 사이 간격 (기본 5): 작을수록 가지가 많다
    "support_base_pattern_spacing": "2.0",   # 서포트 안쪽 간격 (기본 2.5): 작을수록 촘촘

    # 브림/베드 접착 — 세운 상태 + 굴곡이라 베드에 닿는 면이 가는 곡선이라 넓게
    "brim_type": "outer_only",
    "brim_width": "5",                      # 5 → 8 → 6 (조금 줄임)
    "brim_object_gap": "0.05",              # (예전 brim_separation은 Orca에 없는 키라 무시됐음)
    # 실제로 바닥 판을 넓히는 건 이쪽이다: 손톱 자체의 브림(brim_type)은 G-code에 한 번도 안 나왔고, 바닥 판은 서포트 가지의 브림이 만든다.
    # tree_support_auto_brim=1이면 가지마다 폭을 자동 계산하는데, 이 모양은 서포트가 1mm뿐이라 최소값 2mm로 나와서 판이 손톱보다 1.26배(11.2mm)밖에 안 넓다.
    "tree_support_auto_brim": "0",
    "tree_support_brim_width": "6",         # 서포트 브림 폭(mm). 손가락 여러 개를 한 번에 뽑을 땐 이웃 판과 겹치지 않게 간격(15mm)의 절반 이하로 둔다
    "curr_bed_type": "Textured PEI Plate",
    "initial_layer_line_width": "0.28",     # 첫 줄을 넓게 눌러 붙임
    "initial_layer_speed": ["15"],
    "initial_layer_infill_speed": ["20"],
    "initial_layer_acceleration": ["500"],

    # 벽/쉘
    "wall_loops": "2",                      # 5 → 3: 쉘 두께 0.5mm에는 5줄이 들어갈 수 없어 겹쳐 두꺼워짐
    "top_shell_layers": "4",
    "bottom_shell_layers": "3",
    "detect_thin_wall": "1",                # 얇은 끝부분 누락 방지
    # 껍질이 얇아서 약하고 눈에도 얇아 보이는 문제 (STL은 건드리지 않고 슬라이서에서 보강)
    "outer_wall_line_width": "0.26",        # 0.22 -> 0.26: 선이 굵어서 층끼리 맞닿는 면이 넓어진다
    "inner_wall_line_width": "0.26",

    # 인필
    "sparse_infill_density": "15%",
    "sparse_infill_pattern": "gyroid",

    # 레이어
    "layer_height": "0.08",                 # 0.12 -> 0.08: 큐티클 쪽 둥근 끝(면이 수평에 가까운 곳)의 계단이 덜 보인다. 출력 시간은 약 50% 늘어난다

    # 시임/속도/Z-hop (속도·가속도 계열은 공식 프로파일처럼 리스트 형식)
    # 시임(seam)은 건드리지 않고 프로파일 기본값(aligned)을 쓴다 — back + scarf 조합은 안쪽 끝 마감이 나빴음
    "outer_wall_speed": ["25"],
    "inner_wall_speed": ["60"],
    "small_perimeter_speed": ["20"],
    "top_surface_speed": ["25"],
    "overhang_3_4_speed": ["15"],
    "overhang_4_4_speed": ["10"],
    "z_hop_types": ["Normal Lift"],         # 노즐이 수직으로 올라갔다 이동하는 방식 (z_hop이 0이라 지금은 효과 없음). 예전 이름 z_hop_type은 없는 키라 무시됐다
    "z_hop": "0",                           # 0.2 -> 0: 10개 출력할 때 다른 손가락을 피하려고 뒀는데, 이제 1개만 뽑아서 필요 없다(작은 흔적/실도 줄어든다)
    "enable_overhang_speed": ["1"],
}

FILAMENT_OVERRIDES = {
    "textured_plate_temp": ["75"],
    "textured_plate_temp_initial_layer": ["80"],        # 첫 레이어만 한 단계 높게
    "nozzle_temperature": ["235"],                      # 230 -> 240: 층 접착(층 방향으로 부서지는 문제)
    "nozzle_temperature_initial_layer": ["235"],
    "filament_retraction_length": ["0.5"],
    "close_fan_the_first_x_layers": ["4"],
    "fan_min_speed": ["20"],                            # 40/60 -> 20/30: 팬이 약해야 PETG 층이 더 잘 붙는다
    "fan_max_speed": ["50"],
    "fan_cooling_layer_time": ["15"],
    "slow_down_for_layer_cooling": ["1"],   # 예전 이름 slow_down_for_cooling은 없는 키라 무시됐다 (기본값도 1이라 결과는 같다)
    # 아래 둘은 공정(process)이 아니라 필라멘트 키라 여기로 옮김 (공정에 두면 무시됨)
    "slow_down_layer_time": ["8"],
    "slow_down_min_speed": ["10"],
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

# 시작 G-code(예열 -> 노즐 닦기 -> ... -> 출력 시작)를 우리가 직접 정한다. 내장 프린터 프로파일의 시작 G-code는
# OrcaSlicer 버전/노즐 크기마다 달라서, 노즐 닦기가 빠진 결과가 나온 적이 있다. printer/profiles 의 A1 프로파일은
# 노즐 닦기(wipe nozzle: 베드 끝 청소 부위에 문지르고 솔로 닦는 단계)가 들어 있는 시작 G-code라서 그걸 쓴다.
_MACHINE_START_GCODE_SOURCE = os.path.join(BASE, "profiles", "bambu_a1_machine.json")

# 출력이 끝난 뒤 베드 위치(Y). A1은 베드가 앞뒤로 움직이고, 노즐 기준 Y가 클수록 베드가 사용자 쪽(앞)으로 나온다.
# 끝난 출력물을 꺼내기 쉽게 거의 맨 앞까지(최대 256) 내보낸다. 뒤로 가 있으면 이 값을 키우고, 너무 앞이면 줄인다.
END_PARK_Y = 250


def _nail_tip_start_gcode(start_gcode: str) -> str:
    """시작 G-code를 "예열 -> 홈 -> 노즐 청소 -> 출력"만 남기고 줄인다 (노즐 닦기는 그대로 둔다).

    뺀 것: 베드 레벨링(G29), 압출 보정(calibrating extrusion), XY 기계 진동 점검(mech mode),
    베드 앞에 긋는 시험 선(extrude cali test), 노즐 청소 중 베드 찍기/철판 문지르기(솔 닦기만 남김). 각각 못 찾으면 그 부분만 건너뛰고 로그를 남긴다.

    원래 흐름: 레벨링 플래그가 켜져 있으면 G29를 하고, 꺼져 있으면 그 자리에 G28(홈)을 한다. 레벨링만 지우고
    홈은 건너뛰면 Z 기준이 어긋날 수 있으니, 레벨링을 끈 쪽(G28을 하는 쪽)을 항상 실행하도록 만든다.
    예상한 모양이 아니면(프로파일이 바뀐 경우) 고치지 않고 그대로 돌려준다.
    """
    import re

    def cut(text, pattern, replacement, label):
        out, n = re.subn(pattern, replacement, text, count=1, flags=re.S)
        if n == 0:
            print(f"[Slice] 시작 G-code에서 '{label}' 부분을 못 찾아 그대로 둡니다.")
        return out

    leveling = re.compile(r"M622 J1\n\s+M1002 gcode_claim_action : 1\n.*?M623\n(?=;===== bed leveling end)", re.S)
    home = ("M1002 judge_flag g29_before_print_flag\nM622 J0\n\n    M1002 gcode_claim_action : 13\n"
            "    G28\n\nM623\n")
    head = "M1002 judge_flag g29_before_print_flag\n\nG90\n"
    if not (leveling.search(start_gcode) and home in start_gcode and head in start_gcode):
        print("[Slice] 시작 G-code가 예상한 모양이 아니라 레벨링을 빼지 않고 그대로 씁니다.")
        return start_gcode
    out = leveling.sub("", start_gcode, count=1)
    out = out.replace(head, "G90\n", 1)
    out = out.replace(home, "M1002 gcode_claim_action : 13\nG28\n", 1)
    out = cut(out, r'M1002 judge_flag extrude_cali_flag\n\nM622 J1\n.*?M623 ; end of "draw extrinsic para cali paint"\n',
              "", "압출 보정")
    out = cut(out, r"(;===== mech mode fast check start =+\n).*?(?=;===== mech mode fast check end)",
              r"\1", "기계 진동 점검")
    # 노즐 청소는 "솔 닦기"만 남긴다: 베드 앞쪽 끝을 20번 찍는 단계와, 베드 뒤쪽 철판에 동그라미를 그리며 문지르는 단계(2곳)를 뺀다
    out = cut(out, r";===== remove waste by touching start =+\n.*?;===== remove waste by touching end =+\n",
              "M83\nG1 E-1 F500\nG90\n", "베드 앞쪽 찍기")
    out = cut(out, r"G0 X128 Y261 F20000  ; move to exposed steel surface\nG0 Z-1\.01 F1200 +; stop the nozzle\n\nG91\n(?:G2 [^\n]*\n)+\nG90\nG1 Z10 F1200\n",
              "G90\nG1 Z10 F1200\n", "철판 문지르기(솔 닦기 전)")
    out = cut(out, r"G1 Y250 F30000\nG1 X138\nG1 Y261\nG0 Z-1\.01 F1200 +; stop the nozzle\n\nG91\n(?:G2 [^\n]*\n)+\n",
              "", "철판 문지르기(솔 닦기 후)")
    out = cut(out, r";===== extrude cali test =+\n.*?(?=G1 Z0\.2\n)",
              "G90\nG1 Z1 F1200\nM109 S{nozzle_temperature_initial_layer[initial_extruder]}\nM400\n",
              "시험 선 긋기")  # 선은 안 긋지만 원래 흐름처럼 Z를 올리고, 출력 온도까지 "기다린다"(M109). 이 기다림이 없으면 170도 근처에서 출력이 시작된다
    return out


def _nail_tip_end_gcode(end_gcode: str) -> str:
    """끝 G-code의 마지막 베드 위치(Y)를 END_PARK_Y로 바꾼다. 예상한 줄이 없으면 그대로 돌려준다."""
    import re

    out, n = re.subn(r"^G1 X-48 Y\d+ F3600$", f"G1 X-48 Y{END_PARK_Y} F3600", end_gcode, count=1, flags=re.M)
    if n == 0:
        print("[Slice] 끝 G-code에서 베드 위치 줄을 못 찾아 그대로 씁니다.")
    return out


def _build_patched_machine_profile(output_dir: str) -> str:
    """내장 machine 프로파일을 읽어서 시작/끝 G-code(machine_start_gcode, machine_end_gcode)만 우리 것으로 바꾼 임시 파일을 만든다.
    우리 프로파일 파일을 못 읽으면 내장 프로파일을 그대로 쓴다 (슬라이싱이 막히지 않게)."""
    import json

    try:
        with open(_MACHINE_START_GCODE_SOURCE, encoding="utf-8") as f:
            source = json.load(f)
            start_gcode = _nail_tip_start_gcode(source["machine_start_gcode"])
            end_gcode = _nail_tip_end_gcode(source["machine_end_gcode"])
    except (OSError, KeyError, ValueError) as e:
        print(f"[Slice] 시작 G-code 프로파일을 읽지 못해 내장 프로파일을 그대로 씁니다: {e}")
        return PRINT_PROFILE_MACHINE

    with open(PRINT_PROFILE_MACHINE, encoding="utf-8") as f:
        data = json.load(f)
    data["machine_start_gcode"] = start_gcode
    data["machine_end_gcode"] = end_gcode

    os.makedirs(output_dir, exist_ok=True)
    patched_path = os.path.join(output_dir, "machine_patched.json")
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
    machine_profile = _build_patched_machine_profile(output_dir)

    cmd = [
        ORCASLICER_PATH,
        "--slice", "0",              # 0 = 플레이트 전체 슬라이싱
        "--arrange", "0",
        "--load-settings", f"{machine_profile};{process_profile}",
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


def upload_and_print(gcode_path: str, plate_number: int = 1, remote_filename: str | None = None) -> None:
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
        remote_filename = remote_filename or os.path.basename(gcode_path)
        with open(gcode_path, "rb") as f:
            printer.upload_file(f, remote_filename)

        print(f"[Print] 출력 시작: {remote_filename}")
        printer.start_print(remote_filename, plate_number, use_ams=False)

        print("[Print] 출력 명령 전송 완료.")
    finally:
        printer.disconnect()


def _remote_filename_for(output_dir: str) -> str:
    """프린터 저장소에 올릴 파일명을 출력 작업(output_dir)마다 고유하게 만든다.

    예전엔 매번 sliced.gcode.3mf로 올려서, 앞 출력이 진행 중일 때 다음 작업이 같은
    이름으로 덮어쓸 수 있었다. output_dir은 output/<유저>/<주문ID>처럼 작업마다
    다르므로 마지막 경로 3개를 이어 붙여 이름으로 쓴다.
    """
    parts = [p for p in os.path.normpath(os.path.abspath(output_dir)).replace("\\", "/").split("/") if p]
    tag = "_".join(parts[-3:])
    tag = "".join(c if (c.isalnum() or c in "-_") else "_" for c in tag)
    return f"naily_{tag}.gcode.3mf"


def slice_and_send_to_printer(merged_3mf_path: str, output_dir: str) -> str:
    """
    병합된 3MF -> 슬라이싱 -> 프린터 업로드/출력 시작까지 한 번에 처리.
    반환값: 슬라이싱된 gcode 파일 경로 (S3 백업 업로드 등에 재사용 가능).
    """
    gcode_path = slice_3mf(merged_3mf_path, output_dir)
    upload_and_print(gcode_path, remote_filename=_remote_filename_for(output_dir))
    return gcode_path