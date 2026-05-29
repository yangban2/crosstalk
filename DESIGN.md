# Frame & Socket Inspector — 설계 문서

> iframe `postMessage` 통신과 Socket.IO/WebSocket 통신을 **하나의 타임라인**으로 보여주는 Chrome DevTools 확장.
> micro-frontend, 임베드 위젯, 샌드박스 미리보기처럼 **부모 페이지 ↔ iframe ↔ 백엔드 소켓**이 얽힌 앱의 통신 디버깅을 위한 도구.

작업 코드네임: `frame-socket-inspector` (최종 이름은 §11에서 결정)

---

## 1. 배경 / 문제

iframe 기반 앱 빌더류 제품에서는 통신 채널이 최소 세 갈래로 동시에 흐른다:

1. **Host → iframe** (`iframe.contentWindow.postMessage`)
2. **iframe → Host** (`window.parent.postMessage`)
3. **Host → Backend** (Socket.IO: polling/WebSocket transport)

크롬 기본 DevTools로는:
- postMessage는 **로그가 안 남는다** (수동 `console.log` 없이는 안 보임). cross-origin iframe이면 더 깜깜.
- WebSocket 프레임은 Network 탭에 raw engine.io 프레임(`42["event",...]`)으로만 보여서 **사람이 읽기 힘들다**.
- 두 채널을 **시간순으로 엮어** 볼 방법이 없다 ("소켓으로 서버 이벤트를 받음 → 그 직후 host가 iframe에 명령 메시지를 보냄 → iframe이 결과로 응답" 같은 인과를 추적 불가).

이 도구는 **모든 채널을 하나의 시간축 테이블**에 올리고, 채널·방향·메시지 타입으로 필터링해 인과 추적을 가능하게 한다.

### 1.1 현실의 통신 형태 (설계 가정)

이 도구는 특정 앱/프로토콜에 **종속되지 않는다**. 다만 "현실의 host↔iframe↔socket 통신은 대체로 이렇게 생겼다"는 일반적 관찰을 설계 가정으로 둔다. 모든 이벤트명·네임스페이스는 앱마다 임의이므로, 코어는 이름을 **자동 수집**할 뿐 하드코딩하지 않는다.

**postMessage (host ↔ iframe):**

- 다수가 요청/응답 쌍을 이루며, 상관관계 식별자(보통 `nonce` 또는 `id`)로 왕복을 매칭한다.
- 흔한 envelope 형태: `{ type: string, payload?: object, nonce?: string, timestamp?: number }`
  — 단, `type`/`nonce` 같은 필드명도 앱마다 다를 수 있으므로 best-effort로만 읽는다(§6).

**Socket.IO (`socket.io-client` v4 기준):**

- 이벤트명은 전적으로 앱이 정의한다(emit/on). 코어는 디코드해 이름을 그대로 노출한다.
- 선택적 **네임스페이스**(`/foo`)와 **ack id**를 가질 수 있다 → 파싱해 왕복 추적에 활용.
- transport는 polling으로 시작해 WebSocket으로 업그레이드될 수 있음 → **두 transport 모두 캡처 필요**.
- 핸드셰이크에 `traceparent`(W3C trace context)가 extraHeaders/auth로 실리는 앱이 있음 → 캡처해두면 백엔드 분산추적과 연결 가능 (향후).

---

## 2. 목표 / 비목표

### 목표
- 코드 수정 0으로 (content script 패칭) postMessage **양방향** 캡처.
- Socket.IO/WebSocket의 **폴링 + 웹소켓** 프레임 모두 캡처 + socket.io 프로토콜 **디코드**.
- 모든 이벤트를 **단일 타임시리즈**로 표시 (ms 타임스탬프, 상대시간, 방향 화살표).
- **필터**: 채널(postMessage/socket), 방향, origin/frame, 이벤트 타입, 텍스트 검색.
- 메시지 **payload 펼쳐보기**(JSON tree), 복사.
- nonce/ack 기반 **요청↔응답 페어링**(가능한 경우 왕복 시간 표시).

### 비목표 (v1)
- 메시지 변조/재전송(나중에 고려). v1은 **읽기 전용 관찰**.
- 네이티브 WebSocket이 아닌 다른 실시간 프로토콜(gRPC-web, SSE)은 v2.
- 메시지 흐름 다이어그램 시각화(시퀀스 다이어그램)는 v2.

---

## 3. 아키텍처 개요

```
┌─────────────────────────────── 브라우저 탭 ───────────────────────────────┐
│                                                                            │
│  MAIN world (페이지 JS와 동일 컨텍스트)                                     │
│  ┌──────────────────────────────────────────────────────────┐            │
│  │ inject.js  (패처)                                          │            │
│  │  · window.postMessage 래핑        → outbound postMessage   │            │
│  │  · window.addEventListener('message') 후킹 → inbound       │            │
│  │  · WebSocket.prototype.send/onmessage 래핑 → socket frame  │            │
│  │  · XMLHttpRequest (polling transport) 래핑 → socket frame  │            │
│  │                                                            │            │
│  │  캡처 → window.postMessage({__FSI__: true, evt}, '*')      │ ───┐       │
│  └──────────────────────────────────────────────────────────┘    │       │
│                                                                    │ window│
│  ISOLATED world (확장 전용)                                        │ .postMessage
│  ┌──────────────────────────────────────────────────────────┐    │       │
│  │ content.js                                                 │ ◀──┘       │
│  │  · inject.js 를 <script>로 MAIN world에 주입                │            │
│  │  · __FSI__ 메시지 수신 → chrome.runtime.sendMessage         │ ───┐       │
│  └──────────────────────────────────────────────────────────┘    │       │
└────────────────────────────────────────────────────────────────────┼─────┘
                                                                       │ chrome.runtime
┌──────────────────────── 확장 백그라운드 ─────────────────────────────┼─────┐
│ background.js (service worker)                                       ▼     │
│  · 탭별 이벤트 버퍼링 + DevTools 패널 연결 라우팅                          │
│  · 패널 열리기 전 이벤트도 ring-buffer에 잠깐 보관                          │
└────────────────────────────────────────────────────────────────────┼─────┘
                                                                       │ port
┌──────────────────────── DevTools 패널 ───────────────────────────────▼─────┐
│ panel.html / panel.js                                                      │
│  · 타임시리즈 테이블 (가상 스크롤)                                          │
│  · 필터 바 (채널/방향/타입/검색)                                            │
│  · payload 디테일 (JSON tree)                                              │
│  · clear / pause / export(JSON)                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### 왜 이 구조인가

- **MAIN world 패칭이 필수**: `WebSocket`/`postMessage`/`XHR`는 페이지 컨텍스트의 전역이라, ISOLATED world(content script 기본)에서 패치해도 페이지 코드에는 안 먹는다. manifest v3의 `world: "MAIN"` content script 또는 `<script src>` 주입으로 해결.
- **cross-origin iframe 캡처**: iframe이 별도 origin(예: sandbox 도메인)이면 그 frame에도 content script가 주입돼야 한다 → manifest `matches: ["<all_urls>"]` + `all_frames: true`. 각 frame이 자기 쪽 postMessage in/out을 캡처해 올린다. (호스트만 패치하면 iframe→host의 "보낸 쪽" 기록이 누락됨 — 양쪽에서 잡아 **중복 제거**로 합친다. §6.3)
- **service worker 경유**: DevTools 패널은 탭과 직접 못 붙으므로 background가 라우팅. 패널이 늦게 열려도 직전 이벤트를 놓치지 않게 background가 짧은 ring buffer 유지.

---

## 4. 캡처 상세

### 4.1 postMessage

```js
// outbound: 누가 postMessage를 호출했나
const origPostMessage = window.postMessage.bind(window)
window.postMessage = function (msg, targetOrigin, transfer) {
  emit({ channel: 'postMessage', dir: 'out', targetOrigin, data: safeClone(msg) })
  return origPostMessage(msg, targetOrigin, transfer)
}
// iframe으로 보내는 건 iframeEl.contentWindow.postMessage → 그 iframe의 MAIN world에서 inbound로 잡힘.
// host가 직접 호출하는 contentWindow.postMessage는 "다른 window 객체"라 위 래핑으로는 안 잡힘.
//  → 대안: addEventListener('message') 후킹으로 "받는 쪽"을 진실의 원천(source of truth)으로 삼는다. (§6.3)

// inbound: 이 frame이 받은 메시지
window.addEventListener('message', (e) => {
  if (isOurOwnRelay(e)) return        // __FSI__ relay 메시지는 무시 (피드백 루프 차단)
  emit({
    channel: 'postMessage', dir: 'in',
    origin: e.origin,
    data: safeClone(e.data),
  })
}, true)  // capture phase에서 페이지 핸들러보다 먼저
```

핵심 결정: **"받는 쪽(inbound)"을 1차 진실로 삼는다.** 모든 frame에 주입되므로, host→iframe 메시지는 iframe의 inbound로, iframe→host 메시지는 host의 inbound로 반드시 한 번은 잡힌다. outbound 래핑은 "보낸 직후"의 타임스탬프·호출스택 보강용 보조.

### 4.2 WebSocket (engine.io upgrade 후)

```js
const OrigWS = window.WebSocket
function PatchedWS(url, protocols) {
  const ws = new OrigWS(url, protocols)
  emit({ channel: 'socket', sub: 'ws', dir: 'open', url })
  const origSend = ws.send.bind(ws)
  ws.send = (payload) => { emit({ channel: 'socket', sub: 'ws', dir: 'out', raw: payload }); return origSend(payload) }
  ws.addEventListener('message', (e) => emit({ channel: 'socket', sub: 'ws', dir: 'in', raw: e.data }))
  return ws
}
PatchedWS.prototype = OrigWS.prototype
window.WebSocket = PatchedWS
```

### 4.3 XHR / fetch (engine.io polling transport)

polling은 `…/socket.io/?EIO=4&transport=polling&…` 형태의 XHR(또는 fetch) GET/POST. URL 패턴으로 socket.io 트래픽만 필터해 캡처한다. (모든 XHR을 잡지 않음 — 노이즈 방지)

### 4.4 engine.io / socket.io 프로토콜 디코드

raw 프레임은 사람이 못 읽으므로 디코드한다:

- engine.io 패킷 타입 prefix: `0`open `1`close `2`ping `3`pong `4`message `5`upgrade `6`noop
- engine.io message(`4`) 안에 socket.io 패킷: `0`CONNECT `1`DISCONNECT `2`EVENT `3`ACK `4`CONNECT_ERROR …
- 즉 `42["result_ready",{...}]` = engine `4`(message) + socketio `2`(EVENT) + `["eventName", payload]`
- `42/chat,["message",{...}]` 처럼 네임스페이스 포함 가능 → 파싱.
- ACK: `43[ackId,...]` → emit 한 EVENT의 ackId와 매칭해 왕복 추적.

디코드 실패 시 raw를 그대로 보여주고 `decoded: false` 표시.

---

## 5. 이벤트 데이터 모델

content/inject가 background로 올리는 정규화 이벤트:

```ts
type CapturedEvent = {
  id: string                 // uuid (frame-local)
  t: number                  // performance.timeOrigin + performance.now() (epoch ms, 고해상도)
  tabId: number              // background가 채움
  frameId: string            // frame 식별 (top | url 해시)
  frameUrl: string
  channel: 'postMessage' | 'socket'
  // postMessage
  dir: 'in' | 'out' | 'open' | 'close'
  origin?: string            // inbound의 e.origin
  targetOrigin?: string      // outbound의 targetOrigin
  // socket
  sub?: 'ws' | 'polling'
  socketNamespace?: string
  socketAck?: number
  // 공통
  eventName?: string         // socket EVENT name 또는 postMessage data.type
  data: unknown              // 구조화 클론된 payload (직렬화 안전)
  raw?: string               // socket raw 프레임 (디코드 실패 시)
  decoded: boolean
  // 페어링 (best-effort)
  nonce?: string             // postMessage data.nonce
  pairId?: string            // 같은 왕복으로 묶인 요청/응답 공유 id
  byteSize: number
}
```

### 직렬화 안전 (`safeClone`)
- `structuredClone` 시도 → 실패 시 순환참조/함수/DOM 제거하는 폴백 직렬화.
- 큰 payload(예: code_chunk, 스크린샷 dataURL)는 **truncate** + 원본 크기 표시. 상세창에서 "전체 로드" 버튼.

---

## 6. 엣지 케이스 / 함정

### 6.1 피드백 루프
inject→content 전달도 `window.postMessage`를 쓰면 그게 또 캡처된다. → 전용 마커(`__FSI__`)와 전용 채널로 식별해 **캡처 대상에서 제외**.

### 6.2 주입 타이밍
페이지의 `WebSocket`/`postMessage` 사용보다 **먼저** 패치돼야 한다. → content script `run_at: "document_start"`, inject는 동기 `<script>`로 최상단 주입.

### 6.3 중복 제거 (양쪽 캡처)
host outbound + iframe inbound로 같은 메시지가 2번 잡힐 수 있다. → `(data 해시, 근접 타임스탬프, origin/targetOrigin 짝)`로 dedup. 단 **방향 정보는 보존** (한 행에 out+in 합쳐 왕복으로 표기 가능).

### 6.4 cross-origin 권한
iframe origin을 미리 알 수 없으므로 `<all_urls>`. 사용자에게는 "이 확장은 모든 페이지의 frame 통신을 관찰함"을 README/권한 사유로 명시. (보안 민감 → §9)

### 6.5 service worker 수명
MV3 service worker는 idle 시 종료된다. ring buffer는 영속 아님 → 패널이 열려 port가 연결되면 직접 스트리밍, 닫히면 캡처 일시중지(또는 background가 chrome.storage.session에 짧게 보관).

### 6.6 성능
스트리밍 이벤트(예: 토큰 단위 chunk)처럼 초당 수십~수백 프레임이 올 수 있다. → inject에서 **배치 flush**(rAF 또는 50ms 묶음), 패널은 **가상 스크롤** + 일시정지.

---

## 7. UI / UX

### 타임라인 테이블 (행 = 1 이벤트)

```
┌──────────┬─────┬──────────────┬───────────────────┬──────────────────────────┬──────┐
│ time     │ ch  │ dir          │ event             │ summary                  │ size │
├──────────┼─────┼──────────────┼───────────────────┼──────────────────────────┼──────┤
│ 0.000s   │ 🔌  │ ▲ FE→BE      │ submit_job        │ {id:"…",input:"…"}       │ 412B │
│ +0.31s   │ 🔌  │ ▼ BE→FE      │ job_progress      │ {stage:"plan",steps:3}   │ 1.2K │
│ +2.84s   │ 🔌  │ ▼ BE→FE      │ result_ready      │ url:"https://…"          │ 380B │
│ +2.85s   │ ✉️  │ ▶ host→frame │ HOST_COMMAND       │ nonce:a1b2               │ 64B  │
│ +3.10s   │ ✉️  │ ◀ frame→host │ FRAME_RESULT       │ ⤷ a1b2 · 1080×1920       │ 2.1M │  ← 페어링(왕복 250ms)
└──────────┴─────┴──────────────┴───────────────────┴──────────────────────────┴──────┘
```

- `ch`: 🔌 socket / ✉️ postMessage. 색상으로도 구분.
- `dir`: 화살표 + 라벨. socket은 FE↔BE, postMessage는 frame 관계.
- 페어링된 응답 행에 `⤷ nonce` 와 왕복시간 배지.
- 행 클릭 → 하단(또는 우측) 상세 패널에 JSON tree, raw 프레임, frame URL, 호출스택(가능 시).

### 필터 바
- 채널 토글: `postMessage` / `socket`
- 방향 토글: in / out (또는 FE→BE / BE→FE / host→frame / frame→host)
- 이벤트 타입: 멀티셀렉트(자동 수집된 타입 목록에서)
- frame/origin 셀렉트
- 텍스트 검색 (event명 + payload 전문 검색)
- 컨트롤: ⏸ pause · 🗑 clear · ⬇ export(JSON/HAR-like) · 자동스크롤 토글

### 표시 옵션
- 상대시간(첫 이벤트 기준 / 직전 이벤트 기준 토글) ↔ 절대시간.
- "왕복만 보기" (페어링된 요청/응답만).

---

## 8. 파일 구조 (구현 시)

```
frame-socket-inspector/
├── manifest.json
├── src/
│   ├── inject/
│   │   ├── index.ts          # MAIN world 진입
│   │   ├── patch-postmessage.ts
│   │   ├── patch-websocket.ts
│   │   ├── patch-xhr.ts
│   │   └── socketio-decode.ts # engine.io/socket.io 파서 (단위테스트 핵심)
│   ├── content/
│   │   └── index.ts          # inject 주입 + relay
│   ├── background/
│   │   └── index.ts          # 라우팅 + ring buffer
│   ├── devtools/
│   │   ├── devtools.html/.ts  # panel 등록
│   │   ├── panel.html
│   │   └── panel/             # 테이블/필터/상세 (프레임워크 §10)
│   └── shared/
│       ├── types.ts          # CapturedEvent 등
│       └── dedup.ts
├── tests/
│   └── socketio-decode.test.ts  # 프로토콜 디코드 골든 테스트
├── docs/
│   └── DESIGN.md (이 문서)
├── README.md
└── LICENSE (MIT 예정)
```

---

## 9. 보안 / 프라이버시 (오픈소스 공개 전 필수 점검)

- `<all_urls>` + `all_frames`는 **강력한 권한**. README에 명확히 고지.
- 캡처 데이터(토큰, 사용자 payload)가 **로컬 DevTools 밖으로 절대 안 나감** — 외부 전송/원격 로깅 일절 없음. 코드로 보장하고 문서화.
- AUTH 토큰 등 민감 필드는 기본 **마스킹 옵션**(켜기/끄기). 정규식 기반 redaction 설정.
- export 시 "토큰 포함됨" 경고.
- 기본은 **비활성(opt-in)**: 패널을 열어야만 캡처 시작.

---

## 10. 기술 스택 결정 사항 (구현 전 확정 필요)

| 항목 | 후보 | 메모 |
|------|------|------|
| 빌드 | Vite + `@crxjs/vite-plugin` / WXT / 수동 esbuild | MV3 + HMR 편의 |
| 패널 UI | React / Preact / 순수 TS | 테이블·가상스크롤 부담, Preact 경량 후보 |
| 가상 스크롤 | `@tanstack/virtual` / 자체 | 고빈도 이벤트 대응 |
| 언어 | TypeScript | 프로토콜 타입 안전 |
| 테스트 | Vitest | socketio-decode 골든 테스트가 핵심 |

---

## 11. 네이밍 후보

- `frame-socket-inspector`
- `postmessage-timeline`
- `iframe-socket-devtools`
- `crosstalk` (frame 간 cross-talk 관찰 → 짧고 기억하기 쉬움)
- `bridgewatch`

---

## 12. 마일스톤

- **M0 — 스파이크**: inject가 postMessage in/out + WebSocket frame을 콘솔에 찍기. (캡처 가능성 검증)
- **M1 — 코어 캡처**: 3채널 캡처 + socket.io 디코드 + background relay + 최소 테이블.
- **M2 — UX**: 필터/검색/상세/페어링/일시정지/clear.
- **M3 — 다듬기**: dedup, 마스킹, export, 성능(가상스크롤·배치).
- **M4 — 공개**: README, 권한 사유, 스크린샷, MIT, (선택)웹스토어 등록.

---

## 13. 열린 질문

1. v1에서 fetch 기반 polling도 잡을까, XHR만? (socket.io v4 기본은 XHR polling)
2. 페어링 휴리스틱: nonce 없는 메시지는 어떻게 묶나? (eventName + 시간근접 추정 vs 안 묶음)
3. 여러 탭 동시 디버깅 지원 범위 (v1은 현재 탭만으로 충분?)
4. 레퍼런스 통합을 example로 포함할지 (민감정보 없는 더미 데모 페이지 제작?)
