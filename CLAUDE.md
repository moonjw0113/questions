# 차곡 (chagok-study)

고등학생 내신 대비 암기 학습 PWA. React 19 + TypeScript + Vite + Tailwind CSS, Supabase(PostgreSQL/Auth), GitHub Pages 정적 배포. 웹앱에서 OpenAI API를 호출하지 않는다.

## 명령어
- `pnpm dev` 개발 서버
- `pnpm test` 전체 테스트 (`pnpm test:db`는 DB/RLS 통합 테스트만)
- `pnpm build` TypeScript 검사 + 프로덕션 빌드
- `pnpm format` Prettier 적용

## Git 규칙
- 코드 수정이 끝나면 변경 내용에 맞는 메시지로 직접 커밋한다.
- 커밋 메시지는 Conventional Commits 형식(`feat:`, `fix:`, `docs:`, `refactor:`, `test:` 등)으로 쓴다.
- 커밋은 작은 단위로 나눈다.
- `main`에 직접 push하지 않는다. `claude/<작업-요약>` 브랜치에서 작업하고 해당 브랜치로 push한다.
- push 후 `main` 대상 PR을 열고 자동 머지(auto-merge)를 건다. 테스트(`build` 체크)가 통과하면 자동으로 머지되고 GitHub Pages에 배포된다. PR을 직접 머지하지는 않는다.
- 커밋 전에 `pnpm test`와 `pnpm build`가 통과하는지 확인한다.
- `.env`, 키, 토큰 등 비밀 값은 절대 커밋하지 않는다. (`.env.example`만 커밋)

## 주의
- `supabase/init.sql`은 새 프로젝트 초기 설치용이다. 기존 DB에 반복 실행하는 변경을 만들지 않는다.
