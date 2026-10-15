# nail-seg-s.onnx

AR 네일 미리보기에서 카메라 속 손톱을 찾는 손톱 분할(instance segmentation) 모델입니다.
(`src/features/mypage/utils/nailSegmenter.ts`, 실제 추론은 웹 워커 `nailSegmenter.worker.ts`에서 실행)

- 원본: **nails_seg_s_yolov8_v1** by mnemic — https://huggingface.co/mnemic/nails_seg_yolov8
- 라이선스: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (원본 저작자 표기 필요)
- 구조: YOLOv8s-seg, 클래스 1개(`Nail`), 원본은 640px로 학습(75 epoch)
- 변경 사항: 원본 `.pt`의 가중치만 꺼내(pickle 코드는 실행하지 않음) 같은 구조에 다시 담은 뒤
  ONNX(가중치 fp16, 입출력 fp32)로 변환했습니다. 입력 320×320 RGB(0~1), 출력은 YOLOv8-seg 기본 형식
  (`[1, 37, 2100]` 박스·점수·마스크 계수, `[1, 32, 80, 80]` 프로토타입 마스크)입니다.

YOLOv8 구조는 Ultralytics(AGPL-3.0)에서 나온 것이므로, 상용·비공개 서비스에 쓸 때는
라이선스 조건을 따로 확인해야 합니다.
