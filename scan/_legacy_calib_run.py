"""
LEGACY — 일회성 캘리브레이션 스크립트, 더 이상 쓰지 않음. 참고용으로만 보관.

실측 캘리브레이션 스크립트 (임시).
color/finger/{d,s,sm,w,y} 5명의 10손가락 이미지를 실제 파이프라인(원격 seg 포함)으로 돌려서
AggregatedMetrics의 L/brightness/warmness/saturation/contrast 분포를 뽑는다.
"""
import glob
import json
import os

from naily_pipeline import run_pipeline_10fingers

PEOPLE = ["d", "s", "sm", "w", "y"]

results = []
for person in PEOPLE:
    paths = sorted(glob.glob(f"finger/{person}/*.jpg"))
    if not paths:
        print(f"[skip] {person}: 이미지 없음")
        continue
    try:
        out = run_pipeline_10fingers(paths, person_name=person, save_seg=False)
        results.append({"person": person, **out["aggregated"]})
    except Exception as e:
        print(f"[FAIL] {person}: {e}")

with open("_calib_results.json", "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

print("\n\n" + "=" * 60)
print("요약")
print("=" * 60)
for r in results:
    print(f"{r['person']:>4}: L={r['L']:.2f}  brightness={r['brightness']:.3f}  "
          f"warmness={r['warmness']:.2f}  saturation={r['saturation']:.3f}  "
          f"contrast={r['contrast']:.3f}  reliability={r['reliability']}")
