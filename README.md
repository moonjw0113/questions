# 차곡 · 매일 쌓이는 나의 공부

고등학생의 내신 대비를 위한 모바일 중심 암기 학습 PWA입니다. React 19 + TypeScript + Vite + Tailwind CSS, Supabase PostgreSQL/Auth를 사용하고 GitHub Pages에 정적으로 배포합니다. 웹앱에서 OpenAI API를 호출하지 않습니다.

## 빠른 실행

Node.js 22.12 이상(24 권장), pnpm 11.25.0을 설치합니다.

```powershell
pnpm install --frozen-lockfile --store-dir .pnpm-store --node-linker=hoisted --package-import-method=copy
Copy-Item .env.example .env
pnpm dev
```

터미널에 표시되는 로컬 주소를 엽니다. Supabase를 설정하기 전에는 **체험 모드**가 열립니다. 예시 문제와 학습 기록은 이 브라우저의 `chagok-demo-v1`에만 저장됩니다. 계정 데이터와 자동으로 섞이지 않습니다. 체험 중 만든 문제·기록은 전체 백업 후 실제 계정에서 복원할 수 있습니다.

```powershell
pnpm test          # 채점·JSON 계약·복습·내보내기·저장소·PostgreSQL/RLS 테스트
pnpm test:db       # PostgreSQL 통합 테스트만
pnpm build         # TypeScript 검사 + 프로덕션 빌드 + 서비스 워커
pnpm preview       # dist 미리보기
```

## Supabase 연결

1. Supabase에서 프로젝트를 만듭니다. **새 프로젝트**의 SQL Editor에서 `supabase/init.sql` 전체를 실행합니다. SQL은 초기 설치용이며 기존 테이블을 삭제하지 않습니다. 이미 설치된 DB에 반복 실행하지 마세요.
2. Authentication → Providers에서 이메일/비밀번호를 활성화합니다. 이메일 확인을 켠 경우 가입 메일의 링크로 확인한 뒤 로그인합니다. 앱 비밀번호는 8자 이상입니다.
3. Authentication → URL Configuration의 Site URL과 Redirect URLs에 로컬 개발 주소와 실제 배포 주소를 추가합니다. 예: `http://localhost:5173/`, `http://127.0.0.1:5173/`, `https://USERNAME.github.io/REPOSITORY/`.
4. `.env`에 프로젝트 URL과 **publishable 키 또는 legacy anon 키**를 넣습니다. Vite를 재시작합니다.

```dotenv
VITE_SUPABASE_URL=https://PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
VITE_BASE_PATH=/
```

`service_role`, `sb_secret_...`, OpenAI 키는 사용하지 않습니다. 브라우저에 공개 가능한 키만 허용하며, 빌드 설정과 클라이언트 모두 잘못된 종류의 키를 거부합니다. 공개 키 자체는 번들에 포함됩니다. 실제 접근 통제는 RLS와 사용자 소유권을 확인하는 서버 RPC에서 수행합니다.

Supabase 설정이 유효하면 로그인/회원가입 화면이 먼저 열립니다. 계정 모드에서 문제·답안·세션·복습 일정·설정은 Supabase가 기준 저장소입니다. 다른 기기의 변경은 창에 다시 포커스할 때와 30초 간격으로 갱신합니다. 동일 세션을 여러 기기에서 동시에 변경하면 revision 충돌을 표시합니다. 새로고침 후 이어서 학습하세요.

## 매일 사용하는 흐름

1. **별도의 ChatGPT Work**에 교과서·학습지·필기, `public/prompts/generate.txt`, `public/question-bank.schema.json`을 전달합니다.
2. 생성된 JSON을 문제은행 → 문제 가져오기에서 파일 선택/드래그 또는 텍스트 붙여넣기로 가져옵니다. 오류 위치, 유형별 개수, 신규/변경/중복 수와 미리보기를 확인하고 저장합니다.
3. 학습에서 과목·단원·유형·난이도와 전체/최근 오답/복습 예정/즐겨찾기를 고릅니다. 일반 학습은 즉시 채점, 복습은 기한이 지났거나 숙련도가 낮은 문항 우선, 시험은 무작위 출제 후 일괄 채점합니다.
4. 단답형은 등록된 허용 답안만 인정합니다. 공백·일부 문장부호·영문 대소문자 차이를 무시하지만 마이너스, 소수점, 연산자와 부정 표현은 보존합니다. 과도한 의미 추론은 하지 않습니다. 필요하면 정답/오답을 수동 수정할 수 있습니다.
5. 빈칸은 `answer.blanks` 순서로 입력하고 빈칸별 정오답과 부분 점수를 제공합니다. 채점 후 완성 문장과 해설을 표시합니다.
6. 입력 초안은 변경 후 약 1.1초에 저장합니다. **잠시 쉬기**는 현재 답안·시간·위치를 즉시 저장합니다. 저장 전 새로고침에는 브라우저 경고를 요청합니다. 저장된 세션은 다른 기기에서도 이어갈 수 있습니다.
7. 통계 → 학습 결과 내보내기에서 범위를 고르고 `study_result` JSON과 분석 요청 프롬프트를 받습니다. Work에 함께 전달하고, 생성된 새 문제 파일을 다시 가져옵니다.

## 고정 문제 JSON v1.0

**이 파일 규격은 외부 계약입니다.** `schema_version`, `bank`, `questions`만 최상위에 두며, 문제 파일에 버전·생성 시각·DB UUID를 요구하지 않습니다. 한 문제은행 파일은 한 과목·한 단원입니다.

```json
{
  "schema_version": "1.0",
  "bank": { "id": "biology-cell-01", "title": "세포 핵심 개념", "subject": "생명과학", "unit": "세포와 물질대사" },
  "questions": [
    {
      "id": "q1", "type": "multiple_choice", "topic": "세포 소기관", "difficulty": 1,
      "prompt": "세포 호흡이 일어나는 주요 소기관은?",
      "options": [{ "id": "A", "text": "미토콘드리아" }, { "id": "B", "text": "리보솜" }],
      "answer": { "option_id": "A" }, "explanation": "미토콘드리아에서 세포 호흡이 일어납니다.", "tags": ["미토콘드리아"]
    },
    {
      "id": "q2", "type": "short_answer", "topic": "효소", "difficulty": 1,
      "prompt": "효소가 낮추는 에너지는?", "answer": { "accepted": ["활성화 에너지", "activation energy"] },
      "explanation": "효소는 활성화 에너지를 낮추어 반응 속도를 높입니다.", "tags": ["효소", "활성화 에너지"]
    },
    {
      "id": "q3", "type": "fill_blank", "topic": "물질대사", "difficulty": 2,
      "prompt": "합성하는 반응은 {{1}} 작용, 분해하는 반응은 {{2}} 작용이다.",
      "answer": { "blanks": [{ "id": "1", "accepted": ["동화"] }, { "id": "2", "accepted": ["이화"] }] },
      "explanation": "동화는 합성, 이화는 분해입니다.", "tags": ["물질대사"]
    }
  ]
}
```

- `bank.id`, 문제 `id`, 선택지 `id`: 1~100자의 영문·숫자·밑줄·하이픈. 문제 ID는 **은행 내에서 고유**합니다. 다른 은행의 같은 문제 ID는 별개의 문제입니다.
- `bank.title/subject/unit`: 공백만으로 구성되지 않은 1~200자. 질문·해설·답안 등은 10,000자 이하입니다.
- 객관식은 2~10개의 선택지와 단일 정답 ID를 사용합니다. 기본 예제는 4지선다입니다.
- 빈칸 ID는 양의 정수를 문자열로 표현합니다. 본문의 `{{1}}` 등과 정확히 일치하고 각 ID가 한 번씩 등장해야 합니다. 배열 순서가 입력·채점 순서이며 숫자 크기 순서일 필요는 없습니다.
- 한 파일 최대 2,000문제, 10MB. 스키마 외 필드, 누락 필드, 중복 ID, 존재하지 않는 정답 선택지, 불일치 빈칸, 빈 답안을 구체적인 오류로 표시합니다.

예제는 `public/examples/biology.json`(세 유형 통합), `multiple_choice.json`, `short_answer.json`, `fill_blank.json`입니다. 최종 스키마는 `public/question-bank.schema.json`에 있습니다.

## 문제 식별과 기록 보존

DB의 `questions.id`는 UUID입니다. 외부 문제의 식별자는 `(user_id, bank_id, external_id)`이고 프론트엔드의 결합 키는 `bank.id::question.id`입니다. 허용 ID 문자에 `:`가 없어 충돌하지 않습니다. `dbId`는 화면 내부에서만 사용되며 Work 분석 파일에 들어가지 않습니다.

같은 내용의 재업로드는 중복으로 제외합니다. 같은 식별자의 내용이 달라지면 서버가 내부 버전을 1씩 올리고 `question_versions`에 불변 스냅샷을 추가합니다. 과거 내용을 다시 올려도 현재 버전을 과거로 되돌리지 않습니다. 은행의 과목·단원은 변경할 수 없고 새 은행 ID를 사용해야 합니다. ID를 유지하면 문항 수정, ID를 바꾸면 새 문제입니다.

답안과 세션은 풀던 **당시의 문제 버전**을 참조합니다. 수정·재가져오기·복원에도 이전 답변, 정답, 해설, 통계와 진행 중인 세션을 보존합니다. 문제 삭제는 soft delete이며 삭제 목록에서 복구할 수 있습니다. 과목·단원은 사용 중이면 외래 키로 삭제를 차단합니다. 개발 중 최초 설계의 내부 채점 타입은 어댑터로 재사용했고, 외부 JSON만 고정 v1.0으로 바꾸었습니다. 최초 설치 전 생성한 계정 DB는 없습니다.

## 데이터와 복습 설계

| 테이블 | 역할 |
| --- | --- |
| profiles | 사용자 설정 |
| subjects / units | 사용자가 만든 과목·단원 |
| question_banks | 외부 은행 ID와 과목·단원 |
| questions | 내부 UUID, 외부 문제 ID, 현재 버전, 즐겨찾기·오류 메모·삭제 상태 |
| question_versions | 불변 문제 원본 JSON과 정규화된 내부 스냅샷 |
| study_sessions | 문제 순서·선택지 순서·입력 초안·시간·진행 위치·revision |
| answer_attempts | 답변·서버 채점·부분 점수·수동 채점·모드·시간·누적 횟수 |
| review_progress | SM-2 기반 회상 숙련도와 다음 복습 시각 |

모든 테이블은 사용자별 RLS와 소유자 포함 복합 외래 키를 사용합니다. 일반 사용자는 자기 행 조회와 즐겨찾기·삭제·오류 메모 수정만 직접 할 수 있습니다. 문제 가져오기, 답안 저장, 복원은 로그인 사용자 ID를 서버에서 결정하는 RPC를 사용합니다. 임의 user_id, 점수, 누적 횟수, 복습 일정을 신뢰하지 않습니다. 서버가 정답 데이터로 점수를 계산합니다. 한 세션·문제·버전당 답안은 한 개여서 재시도에 따른 중복 기록을 차단합니다. DB에서 사용자 소유 행 전체를 하나의 스냅샷 RPC로 가져와 통계를 계산하므로 PostgREST 기본 1,000행 제한으로 통계가 잘리지 않습니다.

복습은 [SuperMemo SM-2 원문](https://www.super-memory.com/english/ol/sm2.htm)을 참고한 단순 변형입니다. 정답의 기본 간격은 1일 → 6일 → 이전 간격×ease(최대 365일)이며, 오답/부분 정답은 10분 후 다시 복습합니다. 마지막 10회에 최근 가중치를 주고 연속 정답을 반영해 문항 숙련도를 구합니다. 개념 이해도라고 주장하지 않습니다. 새 문제의 `topic/tags`를 같은 개념의 지표로 사용합니다. TypeScript 알고리즘은 `src/domain/review.ts`, 서버 동등 구현은 SQL의 `rebuild_study_progress`입니다. 알고리즘 변경 시 둘을 함께 변경하고 동등성 테스트를 실행하세요. 학습 날짜와 연속 일수는 한국 시각(Asia/Seoul)을 기준으로 합니다.

설정의 복습 방식은 다음 답안부터 적용합니다. 최근 오답 필터는 **그 문제의 마지막 풀이가 완전 정답이 아닌 경우**, 취약 개념은 최근 100회에서 정답률 80% 미만인 태그를 뜻합니다. 전체·최근 정답률은 부분 점수의 평균입니다. 학습 진행률은 활성 문제 중 한 번 이상 푼 문제 비율입니다.

## study_result와 백업은 서로 다른 파일

`public/study-result.schema.json`은 분석 전용 **study_result v1.0**을 정의합니다. 문제 파일과 다르게 `type: "study_result"`, 통계, 개념별 성적, 빈번한 오답, 시간별 실제 답안·모범답안, 현재 문항 숙련도와 추가 학습 주제를 포함합니다. 과목/단원/7일/30일/오답으로 범위를 제한할 수 있습니다. 문제 식별자는 `bank_id + question_id`이며 `internal_version`은 분석 결과에서만 사용합니다. 이메일, 사용자 UUID, DB UUID, 세션 UUID, 인증 토큰은 포함하지 않습니다. 자유 입력한 답변·메모를 Work에 전달할 때에는 필요에 맞게 검토하세요.

전체 백업은 별도 `type: "chagok_backup"`, `schema_version: "1.0"`, `data` 구조입니다. 모든 문제 버전·세션·답안·복습·설정이 들어가고 사용자 인증정보는 제외합니다. 복원은 서버 트랜잭션으로 기존 데이터와 병합하고 중복을 제외합니다. 동일 문제 버전 또는 세션이 충돌하면 전체 작업을 취소하므로 기록을 조용히 덮어쓰지 않습니다. 백업 설정도 복원됩니다. 최대 50MB, 20,000개 문제 버전, 100,000개 풀이 기록입니다.

## GitHub Pages 배포

1. 이 폴더를 GitHub 저장소의 `main` 브랜치에 올립니다.
2. Settings → Secrets and variables → Actions → **Variables**에 다음 공개 값을 등록합니다.
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` (publishable/anon만)
   - 선택: `VITE_BASE_PATH` (`/repository-name/` 또는 사용자 Pages/커스텀 도메인은 `/`)
3. Settings → Pages → Source를 **GitHub Actions**로 선택합니다.
4. `.github/workflows/deploy.yml`이 잠금 파일 설치 → 전체 테스트 → 타입 검사/빌드 → Pages 배포를 실행합니다. PR에서는 테스트/빌드만 수행합니다. 기본 base는 `/<저장소 이름>/`이며 사용자가 설정하면 그 값을 사용합니다.
5. Supabase Redirect URLs에 정확한 배포 경로를 등록하고 해당 주소에서 회원가입·로그인을 확인합니다.

해시 라우팅(`#home`, `#study`, `#session/...`)을 사용하므로 GitHub Pages의 하위 경로와 새로고침에서도 별도 서버 rewrite가 필요 없습니다. PWA의 시작 URL·scope도 base 경로를 따릅니다. iPhone은 Safari 공유 → 홈 화면에 추가, Android는 Chrome의 앱 설치 메뉴를 사용합니다. 업데이트 안내가 표시되면 저장 후 업데이트하세요. 서비스 워커는 앱 정적 파일만 캐시하고 Supabase 인증/데이터 요청은 캐시하지 않습니다. 계정 데이터를 오프라인으로 편집·동기화하는 기능은 제공하지 않으며 연결 오류 시 답안 저장을 재시도해야 합니다.

## 검증 범위

`pnpm test`는 Vitest와 PGlite의 실제 PostgreSQL 엔진으로 초기 SQL을 실행하고 가상 auth.uid/인증 역할을 설정합니다. JSON 세 유형, 규격 위반, 은행별 ID, 중복·버전 보존, 한국어 채점, 부분 점수, 복습, 분석 스키마/개인정보, 체험 저장소 전체 흐름, DB 가져오기 원자성, 답안 저장, revision 충돌, RLS 격리/직접 쓰기 금지, 백업 복원을 검증합니다.

실제 Supabase 프로젝트 키와 GitHub 저장소가 이 작업에 제공되지 않아 실제 이메일 전송/실서비스 로그인, Supabase 네트워크 왕복, GitHub Pages 게시 URL은 여기서 검증하지 않았습니다. 로컬 브라우저에서는 모바일·데스크톱 화면, 업로드 검증, 일반/시험 풀이, 부분 채점, 재개와 결과 화면을 확인했습니다. 실제 연결 후에는 회원가입 → 이메일 확인 → 업로드 → 답안 저장 → 다른 기기 재개 → 복습 → 통계 → 내보내기 → 새 파일 가져오기 순서로 최종 확인하세요.

## 소스 구성

```text
src/domain/       고정 파일 타입, 내부 학습 타입, JSON 검증/변환, 채점·복습·통계
src/data/         Supabase 클라이언트, 서버 저장소, 별도 체험 저장소
src/state/        인증·서버 동기화·로딩/오류 상태
src/components/   업로드·내보내기·필터·공용 UI
src/pages/        홈·학습 설정·풀이·문제은행·통계·설정·로그인
public/           JSON 스키마·예제·Work 프롬프트·PWA 아이콘
supabase/init.sql DB·RLS·트랜잭션 RPC·서버 채점/복습
tests/            도메인 테스트와 PostgreSQL 통합 테스트
```

공개 스키마·예제·프롬프트는 단일 원본이며 Vite의 작은 가상 모듈에서 앱에 임베드합니다. 공개 스키마 생성용 유지보수 스크립트는 `scripts/`에 있습니다. 고정 외부 규격 변경은 명시적인 새 schema_version 없이 진행하지 마세요.

참고: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase JavaScript RPC](https://supabase.com/docs/reference/javascript/rpc), [Vite GitHub Pages 배포](https://vite.dev/guide/static-deploy.html#github-pages).
#   q u e s t i o n s  
 