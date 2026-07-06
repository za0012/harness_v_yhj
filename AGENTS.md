# Agent Operating Instructions

이 저장소는 AI 에이전트 하네스 엔지니어링 실험장이다.

## 기본 원칙

- 사용자가 코드 수정을 요청한 경우에만 파일을 수정한다.
- 한 번 시작한 작업은 가능한 한 자율적으로 끝까지 완주한다.
- 막히면 바로 중단하지 말고, 원인 기록, 대안 시도, 축소된 검증 순서로 복구한다.
- 도구 호출, 실패, 재시도, 검증 결과는 Flight Recorder 형식으로 남긴다.
- 최종 답변에는 무엇을 만들었고, 어떤 검증을 했고, 남은 위험이 무엇인지 짧게 보고한다.

## 무중단 완주 루프

1. 목표와 성공 조건을 한 문장으로 정리한다.
2. 필요한 파일과 설정을 먼저 조사한다.
3. 변경 전 실행 계획을 짧게 공유한다.
4. 작업 중 오류가 나면 같은 방식으로 최대 2회 복구한다.
5. 복구가 실패하면 범위를 줄여 최소 동작 버전을 완성한다.
6. 검증 가능한 명령을 실행한다.
7. Flight Recorder 분석 결과나 다음 프롬프트 개선안을 남긴다.

## Supervisor/Runner

- 자율 실행은 `runner/supervisor.py`를 사용한다.
- 상태는 `.harness/runs/<run_id>/state.json`에 저장한다.
- 플랜은 `.harness/runs/<run_id>/plan.json`에 복사해 재개 가능하게 둔다.
- 상태 전이는 `pending -> running -> recovering -> validating -> completed/blocked`를 따른다.
- `pnpm install`, `pnpm run build`, `pnpm exec` 같은 Node 패키지 명령은 PowerShell이 아니라 bash에서 실행한다.
- bash가 없거나 패키지 다운로드가 막히면 실패로 반복하지 말고 blocker로 기록하고 가능한 오프라인 검증을 끝낸다.
- 에이전트 실행 단계는 `kind: "agent"`와 `adapter: "codex"`로 표현한다.
- Codex 명령 실행은 `runner/adapters/codex_adapter.py`가 담당한다. `HARNESS_CODEX_COMMAND`가 있으면 그 명령을 쓰고, 없으면 `codex` 실행 파일을 찾는다.
- 실제 Codex 실행이 불가능한 환경에서는 adapter가 blocker를 기록한다. 하네스 자체 검증에는 `mode: "mock"`을 사용한다.

## 기록 규칙

- 런 ID는 `yyyyMMdd-HHmmss-<slug>` 형식을 권장한다.
- 원본 이벤트는 `.harness/runs/<run_id>/events.jsonl`에 append-only로 저장한다.
- 분석 결과는 `.harness/runs/<run_id>/analysis.json`에 저장할 수 있다.
- 추천 프롬프트는 `.harness/runs/<run_id>/recommended-prompt.md`에 저장할 수 있다.
