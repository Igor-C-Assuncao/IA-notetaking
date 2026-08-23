# Plano de estabilização v0.3.2 — GPU bootstrap, freeze da aba Activity, flip de modo de janela

> **Status: implementado.** Os tres bugs foram corrigidos neste branch.
> `cargo test` 23/23, `cargo clippy --all-targets -- -D warnings` limpo,
> `vitest` 68/68, `tsc --noEmit` limpo, `npm run build` ok.
> Falta apenas a verificacao manual descrita na secao Verification.

## Context

A versão CPU está estável. Três defeitos independentes continuam quebrando o app no Windows:

1. **Download do engine GPU falha com 5/5 retries e culpa a internet** — mesmo com a conexão funcionando. Causa **confirmada empiricamente nesta máquina** (não é hipótese): o cache local tem chunks corrompidos, e o downloader entra num beco sem saída de HTTP 416 que é reportado como erro de rede.
2. **Abrir a aba "Activity" nas configurações trava o computador** — um `setInterval` de 2 s dispara um comando Tauri síncrono que lança dois processos `winget` por chamada, sem guarda de chamada-em-voo. Os processos se acumulam sem limite.
3. **A janela alterna sozinha entre modo expandido e widget** — não existe fonte única de verdade para o modo: o estado React e a geometria real da janela (Rust) são duas verdades que ninguém reconcilia, e um handler de evento do Python força o modo pill pelas costas da UI.

Objetivo: eliminar as três causas de raiz com diff mínimo, com testes que travem as regressões, mantendo o app utilizável quando o sidecar falha.

**Decisões já tomadas com o usuário:**
- Modo de janela: fonte única de verdade (sem persistir o modo entre sessões).
- Falha tardia do sidecar: banner não-bloqueante, o `MainApp` nunca é desmontado.
- `check_ollama`: async + dedupe de chamada em voo + cache TTL (mantém a detecção "instalado mas parado").
- Cache GPU corrompido: auto-recuperação silenciosa no downloader (+ comando manual de limpeza para destravar agora).

---

## Evidência: a causa do bug da GPU, medida nesta máquina

Manifest oficial de `v0.3.2` vs. `%APPDATA%\com.opensource.ainotetaker\engines\0.3.2\gpu.download\`:

| Arquivo | Tamanho esperado | Em disco | SHA-256 |
|---|---:|---:|---|
| `...gpu.zip.part01` | 1.900.000.000 | 1.900.000.000 ✔ | **`621235a1…` ≠ `fe34615b…` ✘** |
| `...gpu.zip.part02` | 1.667.635.652 | **1.667.636.305 (+653 B) ✘** | — |
| `...gpu.zip` (montado) | 3.567.635.652 | **3.567.636.305 (+653 B) ✘** | — |

O release e o manifest estão íntegros e os assets respondem a Range — o problema é 100% do lado do cliente. **`part01` é o caso patológico exato**: tamanho perfeito, conteúdo errado.

Trace do que acontece hoje em `src-tauri/src/lib.rs`, com esses bytes reais:

1. `download_engine_blocking:585-609` itera os chunks; `part01` é o primeiro.
2. `verify_file:985-994` → tamanho bate, **hash não bate** → `download_resumable_asset` entra no laço de retry.
3. `:744-748` calcula `offset = len.min(expected_size)` = `min(1.900.000.000, 1.900.000.000)` = **exatamente o tamanho esperado**.
4. Envia `Range: bytes=1900000000-` → GitHub responde **HTTP 416 Range Not Satisfiable** (verificado ao vivo contra o asset real).
5. `:883-899` emite `"Server returned HTTP 416...; retrying (n/5)"`, cinco vezes.
6. `:922` retorna a **única** mensagem terminal que existe: *"Download failed after 5 attempts. Check your network, proxy, or antivirus and retry"*.

É exatamente o sintoma relatado. O arquivo nunca é truncado, então **o estado é permanente**: toda nova tentativa repete o mesmo 416, para sempre.

> Tamanho exato com conteúdo errado aponta para o arquivo ter sido **reescrito** depois de baixado — antivírus (quarentena e restauração) ou proxy — ou para a escrita desalinhada de `:767-770`. É precisamente a classe "integridade", que hoje é rotulada como problema de rede.

Defeitos adjacentes no mesmo laço, todos contribuintes:
- `:767-770` quando `resumed`, faz `seek(SeekFrom::End(0))` em vez de `seek(Start(offset))`. Como `offset` foi truncado por `.min(expected_size)`, arquivos já longos demais **crescem ainda mais** a cada tentativa. É a origem provável dos 653 bytes extras do `part02`.
- `:805-811` escreve o buffer **antes** de checar `written > expected_size`, então o overshoot já foi para o disco quando o `break` acontece.
- `:873-881` quando a verificação pós-stream falha, nada é emitido, nada é truncado, e o laço volta ao mesmo beco.
- `:869` `RecvTimeoutError::Disconnected` sai em silêncio, sem mensagem.
- `:922` é o destino comum de transporte, HTTP 4xx, size mismatch e checksum mismatch. `verify_file` produz `"size mismatch"` / `"checksum mismatch"` e ambos são **descartados**.
- `:626-627` se o zip montado falha no checksum, ele **nunca é apagado** — é o segundo veneno permanente do cache (e está presente nesta máquina).
- `:531-542` a checagem de espaço no caminho chunked ignora a cópia montada por `combine_chunks` (GPU precisa de ~13,3 GB reais; só ~9,7 GB são checados). Pior: `directory_size` conta o zip montado, inflando `cached_bytes` e subestimando ainda mais o requisito.
- `emit_download_progress:938-947` extrai o número da tentativa **de volta da string** da mensagem (`message.split("retrying (")`).

---

## Ordem de execução: **Bug 2 → Bug 3 → Bug 1**

- **Bug 2 primeiro**: é o que congela a máquina, e o popover é o gatilho compartilhado dos bugs 2 e 3 — não dá para reproduzir o bug 3 com conforto enquanto abrir a aba Activity trava o computador.
- **Bug 3 depois**: mexe em `EngineBootstrap.tsx` nas mesmas regiões que o bug 1 depois toca.
- **Bug 1 por último**: maior diff em Rust, isolado no caminho de download. O comando de limpeza manual abaixo já destrava a instalação da GPU **hoje**, sem esperar o rebuild.

---

## Destravar a GPU agora (rodar uma vez, antes de tudo)

Os três arquivos estão corrompidos — inclusive o `part01` —, então o diretório inteiro vai fora:

```powershell
$e = "$env:APPDATA\com.opensource.ainotetaker\engines\0.3.2"
Remove-Item "$e\gpu.download"  -Recurse -Force
Remove-Item "$e\gpu.installing" -Recurse -Force
```

> `gpu.installing` é resto de uma instalação que não completou o rename atômico (`lib.rs:669-671`). O código já o apaga em `:631-633`, mas removê-lo evita confusão ao diagnosticar. São ~3,6 GB para rebaixar; nada aqui é reaproveitável.

Depois disso o bootstrap da GPU deve completar. As correções do Bug 1 existem para que isso **não volte a acontecer** e para que, se acontecer, o app se cure sozinho em vez de mentir sobre a rede.

---

## Bug 2 — Aba "Activity" lança processos sem limite

O rótulo "Activity" corresponde ao id interno `"diagnostics"` (`PopoverWidget.tsx:37`, botão em `:450-455`, painel em `:801-841`).

### Causa

`src/widgets/PopoverWidget.tsx:111-123` roda `window.setInterval(refresh, 2000)` sem guarda de chamada em voo — `disposed` só suprime o `setState`, não cancela o `invoke`. Cada `refresh` chama `check_ollama`.

`src-tauri/src/lib.rs:1433-1528` `check_ollama` é um `#[tauri::command]` **síncrono** (em Tauri v2 roda na main thread) e por chamada lança `winget --version` e `winget list --id Ollama.Ollama -e`, mais duas requisições `reqwest::blocking` de 2 s para `localhost:11434`. No Windows `winget` é um App Execution Alias: cada invocação sobe `WindowsPackageManagerServer.exe` + `conhost.exe` e pode levar 5-30 s atualizando fontes. A 2 processos por chamada a cada 2 s, sem dedupe, a pilha cresce sem limite → o PC congela.

> Nota estrutural: hoje o `winget` roda **incondicionalmente antes** do probe HTTP, mas o ramo de sucesso retorna `installed: true` sem nunca consultar o resultado. Invertendo a ordem, numa máquina saudável o `winget` **nunca é lançado**.

### 2.1 Rust — `src-tauri/src/lib.rs`

**Spawns silenciosos.** Não existe nenhum `creation_flags` em `src-tauri` hoje (só `windows_subsystem = "windows"` em `main.rs:4`), então cada spawn pisca um console em dev. Helper novo junto aos outros helpers (~`:140`):

```rust
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// Probes must never flash a console. Detection only — `winget install`
// keeps its console so the user can watch a long install.
fn quiet_command(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}
```

Aplicar em `nvidia-smi` (`:499`), `winget --version` (`:1435`, `:1532`) e `winget list` (`:1442`). **Deixar `winget install` (`:1550`) como está.**

**Cache com dedupe** (logo após a struct `AppState`, ~`:96`):

```rust
#[derive(Clone)]
struct ProbeCell<T: Clone> {
    value: Option<T>,
    captured_at: Option<Instant>,
    in_flight_since: Option<Instant>,   // Some => a probe is running
}

#[derive(Clone, Default)]
struct OllamaService { running: bool, models: Vec<String>, active_models: Vec<String> }
#[derive(Clone, Default)]
struct OllamaInstall { winget_available: bool, installed: bool }

const OLLAMA_SERVICE_TTL: Duration = Duration::from_secs(3);
const OLLAMA_INSTALL_TTL: Duration = Duration::from_secs(600);
const GPU_CAPS_TTL: Duration      = Duration::from_secs(600);
const PROBE_STUCK_AFTER: Duration = Duration::from_secs(60);
```

`in_flight_since` é `Option<Instant>` e não `bool` de propósito: um `winget` que trave para sempre dentro do `WindowsPackageManagerServer.exe` não pode envenenar a célula permanentemente — um probe mais velho que `PROBE_STUCK_AFTER` é tratado como abandonado.

```rust
// Ok(Some(v)) = fresh or freshly probed. Ok(None) = another probe is running
// and there is no cached value yet; the caller renders "checking".
async fn probe_cached<T, F>(
    cell: &Arc<Mutex<ProbeCell<T>>>, ttl: Duration, force: bool, probe: F,
) -> Result<Option<T>, String>
where T: Clone + Send + 'static, F: FnOnce() -> T + Send + 'static
```

Corpo: (1) lock curto — dentro do TTL retorna o valor; se há probe em voo e recente, retorna o valor stale (ou `None`); senão marca `in_flight_since`. (2) `tauri::async_runtime::spawn_blocking(probe).await` — o padrão já usado em `:467-474`. (3) re-lock, **sempre** limpar `in_flight_since`, gravar valor e `captured_at`. Mesma disciplina de flag do singleton de `:446-462`.

**`AppState` (`:77-89`)** ganha três campos e `EngineCapabilities` (`:211`) ganha `#[derive(Clone)]`:

```rust
ollama_service: Arc<Mutex<ProbeCell<OllamaService>>>,
ollama_install: Arc<Mutex<ProbeCell<OllamaInstall>>>,
gpu_caps:       Arc<Mutex<ProbeCell<EngineCapabilities>>>,
```

**`check_ollama` (`:1433-1528`)** — dividir em `probe_ollama_service()` (as duas chamadas HTTP) e `probe_ollama_install()` (os dois spawns de winget), e **inverter a ordem**:

```rust
#[tauri::command]
async fn check_ollama(state: State<'_, AppState>, refresh: Option<bool>) -> Result<OllamaStatus, String> {
    let force = refresh.unwrap_or(false);
    let Some(service) = probe_cached(&state.ollama_service, OLLAMA_SERVICE_TTL, force, probe_ollama_service).await?
        else { return Ok(/* state: "checking" */); };
    if service.running { /* ready / loading_model, installed: true — winget nunca roda */ }
    else {
        let install = probe_cached(&state.ollama_install, OLLAMA_INSTALL_TTL, force, probe_ollama_install)
            .await?.unwrap_or_default();
        /* as mensagens offline existentes */
    }
}
```

O split de TTL responde à pergunta de cadência: **3 s** para o probe HTTP (barato, acompanha a UI) e **10 min** para o winget, com `refresh: true` como bypass explícito de ação do usuário. Adicionar `"checking"` ao vocabulário de estado que o popover renderiza.

**Companheiro obrigatório:** `install_ollama_winget` (`:1531`) precisa invalidar `ollama_install` no sucesso (`captured_at = None`), senão o onboarding mostra "não instalado" por 10 min depois de uma instalação bem-sucedida. Adicionar `state: State<'_, AppState>` à assinatura.

**`get_engine_capabilities` (`:495-516`)** — mesma bomba, ainda não armada: lança `nvidia-smi` a cada chamada, síncrono e sem cache. Extrair o corpo para `probe_engine_capabilities()`, tornar o comando `async` com `probe_cached(..., GPU_CAPS_TTL, false, ...)`, e mapear `Ok(None)` para um default conservador de CPU. Nomes em `generate_handler` (`:3179-3180`) não mudam.

> Restrição do Tauri v2: comando `async` que segura `State<'_, _>` **precisa** retornar `Result<_, _>`. As duas assinaturas acima cumprem.

### 2.2 Frontend

**`src/widgets/PopoverWidget.tsx:111-123`** — trocar o `setInterval` por um encadeamento auto-agendado, para que exista no máximo um par de probes em voo. O próximo tick só é marcado no `finally` do anterior, o período sobe de 2 s para 5 s, e o timer vive num binding local cancelado no cleanup (mantendo o `disposed` para o `setState`).

**`src/features/onboarding/steps/OllamaSetup.tsx:31`** — passar `{ refresh: true }` (é ação explícita do usuário).

### 2.3 Testes
- `src/widgets/PopoverWidget.test.tsx` — "não empilha probes de diagnóstico": com `vi.useFakeTimers()` e `check_ollama` mockado como promessa que nunca resolve, entrar na aba Activity, avançar 30 s, e afirmar **exatamente uma** chamada. É o teste de regressão direto da tempestade de processos.
- Rust — `probe_cached_dedupes_concurrent_calls` (contador `AtomicU64` == 1 com duas chamadas concorrentes), `probe_cached_respects_ttl`, `probe_cached_recovers_from_stuck_flag` (setar `in_flight_since` para 2 min atrás e afirmar que um novo probe roda).

---

## Bug 3 — Janela alterna sozinha entre expandido e widget

### Causas (todas confirmadas)

Não existe store: `isExpanded` é `useState` local em `src/features/window-chrome/hooks/useWindowMode.ts:7`, dentro do `MainApp`. `src/App.tsx:156-160` decide o render só por ele. A geometria real vive no Rust (`set_compact_mode` 400x120 / `set_expanded_mode` 1024x720, `lib.rs:1774-1821`). **Nada reconcilia os dois.**

**Causa A (principal)** — `src/features/bootstrap/EngineBootstrap.tsx:171-177`: o handler de `PREFLIGHT_RESULT` invoca `set_compact_mode` incondicionalmente. O `EngineBootstrap` **nunca desmonta** (`:310-312` retorna `{children}` quando pronto), então esse handler fica vivo a sessão inteira. `PREFLIGHT_RESULT` (emitido em `src-python/main.py:237`) é disparado muito depois do startup por `PopoverWidget.tsx:92-109` (500 ms após o popover montar **e** a cada troca de provider/modelo), `:72-82` (a cada `SIDECAR_UP`, ou seja, a cada restart do sidecar), `:703` (botão de re-check) e `main.py:91` (quando o Whisper termina de carregar).

> Repro determinístico: expandir a janela → clicar na engrenagem → ~1 s depois a janela principal encolhe para o pill de 400x120 enquanto o `ExpandedView` continua renderizado.

**Causa B** — `EngineBootstrap.tsx:310-312` renderiza os filhos condicionalmente. `ENGINE_STATE phase=failed` (`:165-168`), `SIDECAR_FAILED` (`:179-186`) ou o watchdog de 45 s (`:198-206`) **desmontam o `MainApp`**. Na recuperação o `MainApp` remonta com `isExpanded = false` e `App.tsx:111-113` reinvoca `set_compact_mode`.

**Causa C** — `useWindowMode.ts:11` `if (isTransitioning) return;` lê estado com escopo de render. Dois gatilhos no mesmo tick (atalho de `App.tsx:148` + clique, ou autorepeat) passam ambos pela guarda e emitem `set_expanded_mode` e `set_compact_mode` em sequência → flip-flop visível. Os sleeps fixos de 100 ms (`:14`) e 180 ms (`:28`) só alargam a janela de corrida.

**Bônus** — `set_compact_mode` (`lib.rs:1782`) força `set_always_on_top(true)`, sobrescrevendo em silêncio o `settings.alwaysOnTop` aplicado em `App.tsx:115-117`.

### 3.1 Novo `WindowModeProvider` — `src/features/window-chrome/WindowModeProvider.tsx`

Fica em `window-chrome` (coeso com `useWindowMode`/`WinCaptionButtons`), não em `app/providers`.

```tsx
export type WindowMode = "compact" | "expanded" | "wizard" | "bootstrap";

interface WindowModeContextValue {
  mode: WindowMode;
  isExpanded: boolean;        // mode === "expanded"
  isTransitioning: boolean;   // apenas para CSS — nunca como guarda
  setMode: (next: WindowMode) => Promise<void>;
  toggleWindowMode: () => Promise<void>;
}
```

Internos:
- `const COMMANDS: Record<WindowMode, string>` mapeando para os quatro comandos Tauri existentes.
- Estado inicial `"bootstrap"` — é onde o app realmente começa.
- **`desiredRef = useRef<WindowMode>` + `queueRef = useRef<Promise<void>>`.** `setMode(next)` retorna cedo se `next === desiredRef.current` (idempotente, espelhando `lib.rs:2887-2892`); senão grava `desiredRef.current = next` **sincronamente** e encadeia o `invoke` em `queueRef.current`. Como a guarda é um ref escrito de forma síncrona, dois gatilhos no mesmo tick não conseguem ambos passar — **é a correção direta da Causa C**.
- O estado React só é atualizado **depois** que o `invoke` resolve, mantendo React e janela em sincronia.
- **Remover os dois `setTimeout`** (`useWindowMode.ts:14` e `:28`). As classes de transição já vêm de `isTransitioning`.
- Depois de cada transição, reaplicar a preferência do usuário: `await getCurrentWindow().setAlwaysOnTop(settings.alwaysOnTop)`. Corrige o `set_always_on_top(true)` hardcoded de `lib.rs:1782` **sem mudar a assinatura do comando Rust** — diff menor que parametrizar o comando.

### 3.2 `useWindowMode.ts` vira um consumidor

Reduzir o arquivo a um re-export do contexto. `MainApp` mantém o destructure de `{ isExpanded, isTransitioning, toggleWindowMode }`, e as props de `CompactWidget`/`ExpandedView` não mudam.

### 3.3 `src/App.tsx`

- `InnerRoot:171-175`: envolver **acima** do `EngineBootstrap`, dentro do early-return de popover, para que o modo sobreviva a qualquer mudança de fase do bootstrap:
  ```tsx
  <WindowModeProvider><EngineBootstrap>{...}</EngineBootstrap></WindowModeProvider>
  ```
- `:111-113`: trocar `invoke("set_compact_mode")` por `setMode("compact")` do contexto. Como `setMode` é idempotente contra `desiredRef`, um remount do `MainApp` não reemite nada — **e se o usuário estava expandido, o `mode` do provider ainda é `"expanded"`, então o remount não encolhe para o pill.** É a correção real da Causa B, e só funciona porque o provider está acima do `EngineBootstrap`.
- `:115-117`: manter o efeito de `alwaysOnTop` (agora reforçado pelo re-apply do provider).

### 3.4 `EngineBootstrap.tsx`

1. **`:171-177` — a correção principal.** Apagar o `invoke("set_compact_mode")`: o handler vira `usePythonEvent("PREFLIGHT_RESULT", () => setPhase("ready"))`. O ramo de `onboarding_completed` existia só para escolher tamanho de janela; o provider é dono disso agora.
2. **`:211`** — `invoke("set_bootstrap_mode")` → `setMode("bootstrap")`.
3. **`:310-312` — parar de desmontar os filhos.** Adicionar `hasBeenReady` (setado na primeira vez que `phase === "ready"`) e:
   ```tsx
   if (phase === "ready" || hasBeenReady) {
     return <>{children}
       {phase === "error" && <BootstrapBanner message={error} onRetry={() => checkEngine(engineKind)} onDismiss={() => setError("")} />}
     </>;
   }
   ```
   O `MainApp` nunca mais é destruído.
4. **`:198-206`** — o watchdog de 45 s não pode disparar pós-ready: `if (phase !== "starting" || hasBeenReady) return;`.
5. **`:59-61`, `:208-215`** — trocar o `let bootstrapEffectRan = false` de módulo por um `useRef`. O propósito original (suprimir o duplo-invoke do StrictMode) é preservado num remount real.
   > Correção da análise inicial: isso é **prioridade baixa**, não um agravante da Causa B. Quando `phase` sai de `"ready"`, o próprio `EngineBootstrap` **continua montado** — só `children` desmonta —, então o flag nunca é reconsultado e `checkEngine` corretamente não reroda (o botão Retry faz isso). O flag só morde se `InnerRoot` remontar o `EngineBootstrap`, o que exige `settings.onboarding_completed` mudar.

### 3.5 Novo `src/features/bootstrap/BootstrapBanner.tsx`

Faixa fixa não-modal, `role="status"`, props `{ message, onRetry, onDismiss }`. Regra `.bootstrap-banner` ao lado de `.bootstrap-shell` em `src/App.css`.

### 3.6 `OnboardingWizard.tsx`

`:51` → `setMode("wizard")`; `:88` e `:100` → `await setMode("compact")`. Os mocks de `OnboardingWizard.test.tsx:64-65` continuam válidos (os invokes ainda disparam).

Depois de 3.3/3.4/3.6, um grep por `set_compact_mode|set_expanded_mode|set_wizard_mode|set_bootstrap_mode` em `src/` só deve achar o provider.

### 3.7 Bônus adjacente — `src/app/providers/IpcProvider.tsx:35-40`

`subscribe` é recriado a cada render e está nas deps do efeito de `usePythonEvent` (`:71`), então todo re-render do provider desinscreve e reinscreve todos os handlers. Não causa o flip, mas um evento Python que caia entre os commits pode ser perdido. `useCallback` no `subscribe` — uma linha, risco baixo, vale fazer enquanto se está nessa área.

### 3.8 Testes
- Novo `src/features/window-chrome/WindowModeProvider.test.tsx`:
  - "dois toggles no mesmo tick geram exatamente uma transição" — **regressão da Causa C**.
  - "setMode é idempotente" — `setMode("compact")` duas vezes → um invoke.
  - "a última requisição vence" — `setMode("expanded")` seguido de `setMode("compact")` → estado final `"compact"`.
  - "reaplica settings.alwaysOnTop ao entrar em compact".
- `src/features/bootstrap/EngineBootstrap.test.tsx` — os mocks atuais (`:8`) stubam `usePythonEvent` como no-op; trocar por um registry mutável de handlers para poder disparar eventos:
  - "não redimensiona a janela quando um preflight chega depois do startup" — disparar `PREFLIGHT_RESULT`, afirmar que `invoke` **nunca** é chamado com `"set_compact_mode"`. **Regressão da Causa A.**
  - "mantém os filhos montados quando o sidecar falha depois de ready" — `PREFLIGHT_RESULT` e depois `SIDECAR_FAILED`; afirmar que o filho continua no documento e que o banner aparece. **Regressão da Causa B.**

---

## Bug 1 — Download do engine GPU

Tudo em `src-tauri/src/lib.rs`, exceto onde indicado.

### 1.1 Taxonomia de erro — enum novo junto a `EngineAssetDownload` (~`:202`)

```rust
enum DownloadFailure {
    Transport(String),
    HttpStatus(u16),
    Integrity(String),   // carrega o "size mismatch"/"checksum mismatch" do verify_file
    Stalled,
    Disk(String),
}
impl DownloadFailure {
    fn retry_label(&self, attempt: u32) -> String;   // mensagem em voo
    fn terminal_message(&self) -> String;            // mensagem final ao usuário
}
```

Uma mensagem por classe — **só `Transport`/`Stalled` podem mencionar rede**:
- `Transport`/`Stalled` → "…a conexão caiu repetidamente. Verifique rede, proxy ou VPN; as partes já verificadas foram mantidas."
- `HttpStatus(416)` → "…o servidor recusou a retomada (HTTP 416). O arquivo parcial foi descartado — tente de novo para baixar do zero."
- `HttpStatus(404)` → "…o pacote desta versão não está disponível na URL (HTTP 404). Atualize ou reinstale o app."
- `HttpStatus(403 | 429)` → bloqueio / limite de taxa.
- `Integrity` → "…os dados baixados não conferem com o checksum esperado ({motivo}). Antivírus, portal cativo ou proxy provavelmente estão modificando o arquivo. Adicione uma exclusão para a pasta de dados do app ou tente outra rede."
- `Disk` → o texto de `actionable_disk_error`.

No laço, manter `let mut last_failure: Option<DownloadFailure>` e trocar a string única de `:922` por `last_failure.map(|f| f.terminal_message())`. **É isso que impede falhas de integridade e 4xx de mandarem o usuário olhar a internet.**

### 1.2 Offset auto-curável — substitui `:744-748`

```rust
fn reset_partial_file(path: &Path) -> Result<(), String>   // set_len(0), ou remove_file no fallback
```

```rust
let on_disk = path.metadata().map(|m| m.len()).unwrap_or(0);
let mut offset = if on_disk >= asset.expected_size {
    // The fast path at :733 already returned for a verified file, so a
    // complete-or-longer file here means the bytes are wrong, not merely
    // incomplete. Resuming would send Range: bytes=<expected_size>- => HTTP 416.
    reset_partial_file(path)?;
    emit_download_progress(/* ... */, attempt,
        "A cached part failed verification and is being downloaded again");
    0
} else { on_disk };
```

O emit importa: sem ele a barra de progresso volta 1,9 GB sem explicação e parece um loop.

### 1.3 Recuperação imediata do 416 — braço não-sucesso `:883-899`

A guarda de offset de 1.2 é necessária mas **não suficiente**: um prefixo curto porém corrompido (ou um servidor que 416 um range legítimo) ainda emperra, porque o arquivo fica intocado e a tentativa N+1 manda o mesmo Range. Adicionar:

```rust
Ok(response) => {
    let code = response.status().as_u16();
    if code == 416 { reset_partial_file(path)?; }   // próxima tentativa começa do zero
    let failure = DownloadFailure::HttpStatus(code);
    emit_download_progress(/* ... */, attempt, &failure.retry_label(attempt));
    last_failure = Some(failure);
}
```

### 1.4 Clamp na escrita — substitui `:805-811`

Cortar o buffer em `expected_size - written` antes do `write_all`, de modo que o arquivo **não possa** exceder o tamanho esperado, e sair com `written >= expected_size`.

> O caminho "arquivo longo demais" e o caminho 416 são o **mesmo** beco (`written > expected` → break → size mismatch → `offset == expected_size` → 416), então 1.2 fecha os dois. O clamp é defesa em profundidade, não um segundo bug independente.

### 1.5 Verificação pós-stream — substitui `:872-881`

```rust
output.flush()?;
drop(output);   // libera o handle antes de set_len / sha256 tocarem o mesmo path (Windows)
match verify_file(path, asset.expected_size, asset.expected_sha256.unwrap_or("")) {
    Ok(()) => return Ok(()),
    Err(reason) => {
        integrity_failures += 1;
        emit_download_progress(/* ... */, attempt,
            &format!("The downloaded data failed verification ({reason}); restarting this part"));
        // Only wipe a COMPLETE-length file. A short file is a valid prefix a Range
        // resume can still finish — `controlled_http_range_resumes_partial_file`
        // depends on this. Escalate after 2 failures to bound the corrupt-prefix case.
        let len = path.metadata().map(|m| m.len()).unwrap_or(0);
        if len >= asset.expected_size || integrity_failures >= 2 { reset_partial_file(path)?; }
        last_failure = Some(DownloadFailure::Integrity(reason));
    }
}
```

### 1.6 Braço `Disconnected` `:869`

Registrar `DownloadFailure::Transport("the connection closed before the transfer finished")` antes do `break`. Seguro contra rotular mal um fim limpo: no caminho feliz o laço sai pelo sentinela de vetor vazio primeiro e, mesmo numa corrida, o `verify_file` seguinte tem sucesso e retorna cedo, então `last_failure` nunca é lido.

### 1.7 `attempt` como parâmetro real

Adicionar `attempt: u32` a `emit_download_progress` (`:926-958`) e **apagar** o bloco `message.split("retrying (")` de `:938-947`. Passar `0` nos call sites não-retry (`:614`, `:635`, `:672`, `:820`). O JSON emitido não muda, então `EngineBootstrap.tsx:395` continua funcionando.

Extrair também `DOWNLOAD_ATTEMPTS: u32` com `#[cfg(test)] = 2` / `#[cfg(not(test))] = 5`, interpolado nos labels no lugar do `/5` hardcoded — mantém os testes novos de mensagem terminal em ~1 s de backoff cada.

### 1.8 Espaço em disco — extrair e corrigir (`:531-542`)

```rust
// Chunked packages exist on disk TWICE: the .partNN files plus the assembled
// package written by combine_chunks. The old formula counted the payload once,
// so GPU passed a ~9.7 GB check but needs ~13.3 GB.
fn required_free_space(entry: &EngineManifestEntry, cached_bytes: u64) -> u64
```

Extrair é o que torna isso testável por unidade. Além disso, `cached_bytes` deve contar **apenas os arquivos de chunk esperados**, não `directory_size` do diretório inteiro (que hoje soma o zip montado e infla o cache). Incluir o requisito absoluto na mensagem de falta de espaço.

Depois **recuperar o pico**: no caminho chunked, após o `verify_file` de `:626` passar e antes do `extract_zip`, apagar os arquivos de parte. É seguro porque o pacote montado já foi verificado.

### 1.9 Segundo veneno do cache — `:626-627`

Se `combine_chunks` monta mas o checksum falha, o zip montado **fica em `.download` para sempre** e toda execução seguinte reproduz a falha idêntica (as partes verificam, remontam, falham de novo). **Está presente nesta máquina agora.** Três linhas:

```rust
if let Err(reason) = verify_file(&package_path, entry.compressed_size, &entry.sha256) {
    let _ = std::fs::remove_file(&package_path);
    return Err(format!("Checksum verification failed ({reason}). The assembled package was discarded; retry the download. Antivirus or a proxy may be modifying it."));
}
```

Com 1.2/1.3/1.5/1.9 o cache se cura sozinho em todos os casos observados — **nenhum botão de "limpar cache" é necessário na UI**. (Opcional, se o antivírus se mostrar reincidente: um comando `clear_engine_download_cache(app, state, kind)` que recusa rodar enquanto `state.engine_download` for `Some`, exposto na UI **só** quando a mensagem terminal for da classe `Integrity`.)

### 1.10 Cosmético — `EngineBootstrap.tsx:345`

`"About 405 MB"` → `"About 674 MB"`, `"About 3.0 GB"` → `"About 3.3 GB"` (valores reais do v0.3.2), com um comentário de que estão duplicados do `engines-manifest.json`.

### 1.11 Testes — em `mod engine_download_tests` (`:1191`)

O `serve_once` (`:1212-1244`) atende **uma** requisição. Adicionar:

```rust
// Answers `responses` in order, one connection each; returns every raw request
// so tests can assert on the Range headers actually sent.
fn serve_sequence(responses: Vec<(&'static str, Vec<u8>)>) -> (String, JoinHandle<Vec<String>>)
```

1. `complete_but_corrupt_file_is_reset_and_redownloaded` — pré-gravar `expected_size` bytes errados; sequência `[("200 OK", good)]`. Afirmar que a única requisição **não** leva header `Range` e que sucede na tentativa 1. **É o caso exato do `part01` desta máquina.**
2. `over_long_file_recovers_and_never_exceeds_expected_size` — pré-gravar `expected_size + 10`; afirmar ausência de `Range` e tamanho final `== expected_size`. **É o caso do `part02`.**
3. `http_416_dead_end_recovers_on_next_attempt` — prefixo curto e errado; sequência `[("416 …", vec![]), ("200 OK", good)]`. Afirmar que a req 1 **tem** `Range`, a req 2 **não tem**, e o resultado é `Ok`. Determinístico só por causa de 1.3.
4. `terminal_message_distinguishes_failure_classes` — com `DOWNLOAD_ATTEMPTS = 2`: 2×404 → contém `"HTTP 404"` e **não** `"network"`; 2×200 com corpo errado do tamanho certo → contém `"checksum"` e **não** `"Check your network"`; host inalcançável → menciona a conexão.
5. `disk_space_precheck_accounts_for_chunk_assembly` — unitário puro em `required_free_space`: entrada chunked exige `>= compressed*2 + unpacked*1.1`; não-chunked bate com a fórmula atual.
6. `retry_label_reports_the_attempt_number` — `DownloadFailure::HttpStatus(416).retry_label(3)` contém `"3/"`.

---

## Verification

**Automático**
```powershell
npm test                              # vitest — inclui as specs novas
cd src-tauri; cargo test; cd ..       # inclui os 6 testes novos do downloader + probe cache
cd src-tauri; cargo clippy -- -D warnings; cd ..
npm run build                         # tsc + vite
```

**Manual — Bug 2 (Activity)**
1. Abrir configurações → aba Activity, deixar aberta 2 min com o Gerenciador de Tarefas ao lado.
2. Com o Ollama rodando: **nenhum** `winget.exe` deve aparecer (o probe HTTP responde primeiro).
3. Com o Ollama parado: no máximo um `winget.exe` por vez, sem acúmulo de `WindowsPackageManagerServer.exe`/`conhost.exe`, UI responsiva o tempo todo.
4. Alternar entre abas repetidamente → nenhum timer sobrevive à saída da aba.

**Manual — Bug 3 (modo de janela)**
1. Expandir a janela → clicar na engrenagem → esperar 5 s. **A janela deve permanecer expandida** (é o repro determinístico de hoje).
2. Trocar de provider/modelo no popover → a janela principal não muda de modo.
3. Matar o processo do sidecar Python pelo Gerenciador de Tarefas → deve aparecer o banner, o `ExpandedView` continua visível e no tamanho certo; o retry restaura sem colapsar para o pill.
4. Ctrl+Shift+E rápido várias vezes → sem flip-flop; o estado final bate com o número de toques.
5. Com `alwaysOnTop` desligado, colapsar para o pill → a janela **não** deve ir para o topo.

**Manual — Bug 1 (GPU)**
1. Depois da limpeza manual, instalar o engine GPU pelo bootstrap → deve completar sem 5/5.
2. Regressão da auto-cura (o cenário real desta máquina): corromper o `part01` já baixado sem mudar o tamanho —
   ```powershell
   $f = "$env:APPDATA\com.opensource.ainotetaker\engines\0.3.2\gpu.download\ai-notetaking-engine-windows-x64-gpu.zip.part01"
   $fs = [IO.File]::Open($f,'Open','Write'); $fs.Position = 1000; $fs.WriteByte(0); $fs.Close()
   ```
   Tentar de novo → o downloader deve truncar e rebaixar sozinho, **sem** mensagem de rede.
3. Desligar a rede no meio do download → aí sim a mensagem deve mencionar rede (é a única classe que pode).

---

## Riscos

- **3.4.3 muda a estrutura de render do `EngineBootstrap`.** O `EngineBootstrap.test.tsx` atual assume que os filhos só aparecem quando `phase === "ready"`; essa asserção precisa ser **atualizada**, não contornada.
- **Com os filhos montados durante uma falha do sidecar**, o botão de gravar do `MainApp` fica clicável com o backend fora do ar e vai falhar no clique. O banner precisa ser proeminente; considerar desabilitar o gravar quando `sidecarState !== "up"` (fora do escopo — fica registrado).
- **`reset_partial_file` descarta até 1,9 GB de progresso.** É o comportamento certo (os bytes são irrecuperáveis), mas só é aceitável porque 1.2 emite a mensagem explicativa — sem ela a UI parece quebrada.
- **TTL de 10 min no winget** atrasa a transição "acabei de instalar o Ollama". Mitigado pelo `refresh: true` no botão de re-check e pela invalidação obrigatória em `install_ollama_winget`.
- **`get_engine_capabilities` vira `async` + `Result`.** Não há chamadores internos em Rust (só a definição e o `generate_handler`); o `invoke<EngineCapabilities>` do lado JS não é afetado.
- **A mudança de assinatura de `emit_download_progress`** toca ~8 call sites — um esquecimento é erro de compilação, não bug silencioso.
- **Ordem de handles no Windows:** o `drop(output)` explícito de 1.5 é obrigatório antes de `verify_file`/`reset_partial_file` tocarem o mesmo path.
- **O novo estado `"checking"` do Ollama** precisa ser tratado por `PopoverWidget.tsx:810` e `OllamaSetup.tsx` (hoje renderizam `status.ollama` verbatim, então degrada bem, mas o texto merece revisão).
