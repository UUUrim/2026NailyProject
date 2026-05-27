# Naily Frontend

React + TypeScript + Vite 기반 웹 프론트엔드입니다.

## 시작하기

```bash
npm install
npm run dev
```

개발 서버: [http://localhost:5173](http://localhost:5173)

## 스크립트

| 명령어 | 설명 |
|--------|------|
| `npm run dev` | 개발 서버 실행 |
| `npm run build` | 프로덕션 빌드 |
| `npm run preview` | 빌드 결과 미리보기 |
| `npm run lint` | ESLint 검사 |

## 폴더 구조

```
src/
├── components/   # 재사용 UI 컴포넌트
├── pages/        # 페이지 단위 컴포넌트
├── styles/       # 앱 스타일
├── types/        # 공통 TypeScript 타입
├── App.tsx       # 루트 컴포넌트
└── main.tsx      # 엔트리 포인트
```

`@/` 별칭으로 `src/` 경로를 import 할 수 있습니다.

```ts
import { Layout } from '@/components/Layout'
```

## 환경 변수

`.env.example`을 참고해 프로젝트 루트에 `.env` 파일을 만드세요.  
Vite 환경 변수는 `VITE_` 접두사가 필요합니다.
