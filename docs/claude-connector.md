# Claude 커넥터 연결

Claude(claude.ai) 대화에서 차곡에 바로 문제를 저장하고 학습 통계를 불러오는 연결입니다.
웹앱은 AI API를 부르지 않습니다. Claude가 차곡의 커넥터 서버(MCP)를 부르는 구조입니다.

```
Claude 프로젝트 대화 ──MCP──▶ Supabase Edge Function(chagok-mcp) ──RPC──▶ Supabase DB
                                       │ 연결 주소의 토큰으로 사용자 확인
```

## 할 수 있는 일

| 도구 | 하는 일 |
|---|---|
| `get_question_format` | 문제 규격(v1.1 스키마)과 출제 규칙을 Claude에게 알려 줌 |
| `list_question_banks` | 내 과목·단원·문제은행 목록 |
| `get_question_bank` | 문제은행 하나의 현재 문제(변형 문제 만들 때 참고) |
| `import_question_bank` | 검사를 통과한 문제만 내 문제은행에 저장 |
| `get_study_result` | 학습 결과(study_result). 기간·과목·단원으로 좁힐 수 있음 |

예시:
- 학습지 사진을 올리고 "이걸로 화학 반응 단원 문제 15개 만들어서 차곡에 넣어 줘"
- "최근 30일 통계 보고 약한 개념 정리해 줘. 그 개념으로 변형 문제 10개 만들어서 저장해 줘"

## 처음 한 번 설치

### 1. Supabase SQL 실행
Supabase 대시보드의 SQL Editor에서 아래 파일을 순서대로 한 번씩 실행합니다.

1. `supabase/question-format-1.1.sql` (v1.1 문제 형식. 이미 실행했다면 건너뜀)
2. `supabase/claude-connector.sql` (연결 주소 저장 표와 함수)

새로 설치하는 프로젝트라면 `init.sql`에 둘 다 들어 있으니 실행하지 않아도 됩니다.

### 2. 커넥터 서버 배포
프로젝트 ref는 Supabase 주소 `https://<ref>.supabase.co`의 `<ref>` 부분입니다.

```powershell
pnpm dlx supabase login
```

```powershell
pnpm mcp:deploy --project-ref <ref>
```

`mcp:deploy`는 서버를 하나의 파일로 묶은 뒤 `chagok-mcp` Edge Function으로 배포합니다.
Claude는 Supabase 로그인 토큰 없이 부르므로 `--no-verify-jwt`로 배포합니다. 대신 연결 주소의 토큰으로 사용자를 확인합니다.

서버는 Supabase가 자동으로 넣어 주는 `SUPABASE_ANON_KEY`를 씁니다. 이 값이 없는 프로젝트(새 API 키만 쓰는 경우)라면
웹앱 `.env`의 공개 키(`sb_publishable_…`)를 비밀 값으로 한 번 넣어 주세요. 공개 키라서 넣어도 안전합니다.

```powershell
pnpm dlx supabase secrets set CHAGOK_PUBLIC_KEY=<공개 키> --project-ref <ref>
```

`service_role`나 `sb_secret_` 키는 절대 쓰지 않습니다.

### 3. 차곡에서 연결 주소 만들기
차곡에 로그인 → 설정 → **Claude 연결** → **연결 주소 만들기** → **복사**

주소는 만들 때 한 번만 보입니다. 잃어버리면 새 주소를 만들면 되고, 그러면 이전 주소는 바로 끊깁니다.

### 4. claude.ai에 커넥터 추가
claude.ai → 설정 → 커넥터 → 사용자 지정 커넥터 추가
- 이름: `차곡`
- URL: 복사한 연결 주소

요금제에 따라 추가할 수 있는 사용자 지정 커넥터 수가 다를 수 있습니다.

### 5. Claude 프로젝트 만들기
새 프로젝트를 만들고, 차곡 설정의 **프로젝트 지침 복사**로 복사한 글을 프로젝트 지침에 붙여 넣습니다.
프로젝트 대화의 도구 메뉴에서 차곡 커넥터를 켜면 준비가 끝납니다.

## 보안
- 연결 주소에는 내 계정용 비밀 토큰이 들어 있습니다. 주소를 아는 사람은 내 문제은행을 읽고 문제를 추가할 수 있으니 공유하지 마세요.
- DB에는 토큰 원문이 아니라 SHA-256 해시만 저장합니다.
- 커넥터로 할 수 있는 일은 문제 읽기·추가(수정 포함)와 통계 읽기뿐입니다. 삭제, 백업 복원, 설정 변경은 할 수 없습니다.
- 차곡 설정의 **연결 끊기**를 누르면 바로 막힙니다.
- 학습 결과에 이메일과 사용자 ID는 들어가지 않습니다.

## 문제가 생기면
- **"연결 주소가 올바르지 않거나 끊어졌습니다"**: 차곡 설정에서 새 주소를 만들고, claude.ai 커넥터의 URL을 바꿔 주세요.
- **"Supabase에 Claude 연결 SQL을 먼저 실행해 주세요"**: 1단계 SQL을 실행하지 않은 상태입니다.
- **커넥터 추가 단계에서 실패**: Edge Function이 배포됐는지, URL이 `…/functions/v1/chagok-mcp/chg_…` 형태 그대로인지 확인해 주세요.
- **저장했는데 앱에 안 보임**: 차곡 앱을 새로고침해 주세요.
- 체험 모드 데이터는 브라우저 안에만 있어서 연결할 수 없습니다.
