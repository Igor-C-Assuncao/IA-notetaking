# Análise do Pipeline de IA e Propostas de Melhoria

> Data: 2026-07-07
> Escopo: pipeline de análise (`src-python/llm_service.py`), prompts dos modelos,
> qualidade da sumarização e apresentação no frontend (`src/widgets/ExpandedView.tsx`,
> `src/features/summary/`).

## Arquitetura atual

O pipeline vive em `src-python/llm_service.py` como um grafo LangGraph **linear** de 4 nós:

1. **Entidades** (`extract_entities_node`) — speakers, números, datas, projetos e siglas,
   a partir do transcript bruto.
2. **Limpeza** (`clean_transcript_node`) — o LLM reescreve o transcript inteiro
   (gramática, fillers, resolução de nomes de speakers via diarização).
3. **Decisões/Ações** (`extract_action_items_node`) — extração com validação de evidência:
   a `evidence_quote` precisa existir *literalmente* (substring normalizada) no transcript,
   senão o claim é descartado (`_validate_evidence_claims`).
4. **Sumário estruturado** (`generate_summary_node`) — JSON com tldr, metrics, participants,
   tags; decisões/ações são sobrescritas pelas verificadas do nó 3.

Reuniões longas usam map-reduce por chunks de segmentos. O frontend tem 3 abas —
transcript, summary (`SummaryDashboard`), actions — e um copilot RAG com índice vetorial
local (`rag_service.py`). Modelo default: `llama3.1:8b` via Ollama, temperatura única 0.2.

---

## 1. Melhorias no pipeline de análise

### a) Campos do schema que existem mas nunca são extraídos ⭐ quick win
`schemas.py` define `risks`, `open_questions` e `unresolved_topics` no `MeetingIntelligence`,
e o `generate_summary_node` faz `setdefault(..., [])` neles — mas **nenhum prompt pede esses
campos**. Chegam sempre vazios na UI. Riscos, perguntas em aberto e tópicos não resolvidos
são o que diferencia uma ata boa de uma lista de tarefas.
**Status: implementado em 2026-07-07** (extração no nó 4 + renderização no `SummaryDashboard`).

### b) Validação de evidência estrita demais
Modelos locais de 8B parafraseiam citações; como o match exige substring exata (normalizada),
decisões e ações reais somem **silenciosamente**. Proposta: match fuzzy
(ex.: `rapidfuzz.partial_ratio >= 85`) com penalidade na confiança e, em vez de descartar,
rebaixar para `inference: true` com confiança baixa — a UI já renderiza o badge "Inferred".
**Status: implementado em 2026-07-07** com `difflib` da stdlib (sem dependência nova no
sidecar). Score = `min(ratio de caracteres, ratio de tokens)` sobre janelas de palavras do
segmento — o ratio de tokens pune troca de palavra ("delete" vs "keep" fica < 0.85 mesmo
com ~0.90 de similaridade de caracteres), então inversões de sentido continuam rejeitadas.
Match exato mantém o claim como está; match fuzzy (>= 0.85) rebaixa para `inference: true`,
penaliza a confiança (`min(confiança, score - 0.1)`) e **substitui a citação pelo texto
real do segmento**, para a UI nunca exibir "evidência" que não está no transcript.

### c) Saída estruturada nativa em vez de regex + repair
O parse hoje é `extract_json_payload` + regex de vírgula + um segundo call de "repair".
O Ollama aceita `format` com JSON Schema (`ChatOllama(format=schema)`) e
OpenAI/Gemini/Anthropic têm `with_structured_output()` no LangChain. Elimina quase todos
os fallbacks, o call extra de repair e o `_fallback_summary_from_state` (qualidade inferior).
Os Pydantic models de `schemas.py` já existem — basta usá-los.
**Status: implementado em 2026-07-07.** Nós 1, 3 e 4 tentam `with_structured_output()`
(schemas `ExtractedEntities`, `ClaimExtraction`, `StructuredMeetingSummary` em `schemas.py`);
o parse regex + repair permanece como rede de segurança se a via nativa falhar.
Validado E2E contra Ollama local (`llama3:latest`) com transcript em português.
De carona: `priority`/`status` são normalizados antes da validação Pydantic (um `"high"`
minúsculo não rejeita mais a ação inteira), e o item **2e** foi implementado
(`key_decisions`/`action_items` removidos do prompt do nó 4).

### d) Nó de limpeza é o mais caro e o mais arriscado
Reescrever o transcript inteiro com um 8B é lento e é onde negações podem ser invertidas.
A extração de decisões/ações usa segmentos brutos; o `clean_transcript` só alimenta o sumário.
Proposta: torná-lo opcional (config) ou substituí-lo por limpeza determinística leve
(regex de fillers + resolução de nomes vinda do nó de entidades). Corta ~40% da latência.

### e) Map-reduce sem fase de consolidação real
No caminho longo: entidades concatenadas sem dedup (mesmo speaker N vezes),
`_deduplicate_claims` só pega duplicatas exatas, e o sumário final recebe `merged_clean` —
o transcript inteiro de novo, que era o que não cabia no contexto. Propostas:
1. passo "reduce" com LLM que consolida entidades e funde claims quase-duplicados;
2. sumário final recebe sumários parciais por chunk, não o transcript completo;
3. processar chunks em paralelo (hoje é sequencial).

### f) Temperatura por nó
Extração (nós 1 e 3) deveria rodar a 0.0; só o sumário se beneficia de 0.2–0.3.
Um dict `temperatures` em `config.DEFAULTS` resolve.

### g) Confiança default enganosa
`_claim_confidence` assume 0.9 quando o modelo omite o campo — o pior caso vira
"High confidence" na UI. Default omitido deveria ser ~0.5.
**Status: implementado em 2026-07-07** (default 0.5).

---

## 2. Melhorias nos prompts

### a) Idioma da saída ⭐ defeito mais visível
Todos os prompts são em inglês e nenhum instrui sobre idioma de resposta. Reunião em
português tende a gerar tldr/decisões/títulos em inglês ou misturado.
**Status: implementado em 2026-07-07** (regra de idioma em todos os nós + prompt RAG).
**Reforço em 2026-07-07:** o teste E2E real mostrou que a regra genérica "detecte o idioma"
não segura um 8B — o idioma detectado pelo Whisper agora é propagado
(`transcription_service` → `main.py` → `MeetingWorkflowEngine(language=...)`) e vira uma
diretriz explícita no topo de cada prompt ("TARGET LANGUAGE: 'pt'"). Validado E2E: saída
100% em português. *Follow-up pendente:* o frontend ainda não persiste o `language` do
evento `TRANSCRIPTION_COMPLETED` para reenviá-lo em `REPROCESS_REQUESTED` (o backend já
aceita `command.get("language")`).

### b) Few-shot para o modelo local
Modelos 8B melhoram drasticamente com 1 exemplo completo de entrada→saída por prompt.
Vale especialmente no nó 3 (distinção "sugestão vs. compromisso"). Custa ~400 tokens.

### c) Exemplo de schema induz valores errados
O schema do nó 3 mostra `"confidence": 0.0` — modelos pequenos copiam o exemplo
(confirmado no teste E2E real: o llama3 devolveu 0.0 literalmente).
Trocar por rubrica: *"1.0 = compromisso explícito verbatim, 0.5 = fortemente implícito,
< 0.4 = inferência fraca"*.
**Status: implementado em 2026-07-07** (rubrica na regra 6 do nó 3 + placeholder 0.9).

### d) Campos que convidam alucinação
`engagement_level` e `trend` não têm definição — o modelo inventa. Ou definir critérios
objetivos, ou (melhor) computar `engagement_level` do tempo de fala da diarização, e só
incluir `trend` se explicitamente dito na reunião.

### e) Tokens desperdiçados no nó 4
O prompt pede `key_decisions`/`action_items` no schema, mas o código **sobrescreve** ambos
com os verificados do nó 3. O modelo gasta tokens gerando listas jogadas fora.
Remover esses campos do schema pedido reduz latência.
**Status: implementado em 2026-07-07** (junto com o item 1c).

### f) `summary_points` sem contrato — e descartado pela UI
Dois problemas: (1) o prompt não define quantidade/altitude dos pontos; (2) o
`SummaryDashboard` **nunca renderizava** `summary_points` — o modelo gastava tokens
gerando uma lista que a UI descartava.
**Status: implementado em 2026-07-07** (contrato "3 a 6 pontos, tópicos distintos,
ordenados por importância, sem repetir o tldr" no nó 4 + seção "Key Points" na UI).

---

## 3. Sumarização e apresentação — nova aba de alto nível

### a) Nova aba "Briefing"
Camada entre "transcript" (baixo nível) e "summary" (médio):

- **Capítulos da reunião** — novo nó de *topic segmentation* que divide os segmentos em
  capítulos com título, faixa de tempo e 1–2 frases. Clicar no capítulo salta para o
  segmento no transcript (mecanismo `onViewEvidence`/`highlightedSegmentId` já existe).
- **Riscos / perguntas em aberto / não resolvidos** — item 1a.
- **Estatísticas de participação** — tempo de fala por speaker calculado da diarização
  (determinístico, custo zero de LLM).
- **Rascunho de follow-up** — call extra que gera e-mail de follow-up a partir do JSON
  estruturado (não do transcript — barato, sem alucinar fatos novos).
- **Continuidade entre reuniões** — usar o índice RAG existente: ao processar uma reunião,
  buscar anteriores similares e gerar "o que mudou desde a última" (decisões revertidas,
  ações recorrentes nunca concluídas, tópicos que reaparecem). Recurso mais diferenciado;
  infraestrutura já construída.

**Status: implementado em 2026-07-08** (exceto "continuidade entre reuniões", que é o
item 7 do roadmap). Decisões de implementação:
- **Capítulos**: nó `segment_topics_node` (nó 3.5) com structured output
  (`ChapterExtraction`) + fallback raw. O LLM devolve apenas `title` +
  `start_segment_id` + `summary`; timestamps são derivados deterministicamente em
  `_finalize_chapters` (ids inexistentes descartados, dedupe, 1º capítulo forçado ao
  início, cap de 12). Presente nos **dois** caminhos de `run()` (grafo curto e
  map-reduce por chunk, com re-finalização sobre os segmentos completos por causa do
  overlap). Skip determinístico com < 4 segmentos.
- **Participação**: `_compute_participation` (função pura, sem LLM) — turnos, tempo de
  fala e % por `speaker_id`; degrada para % por palavras quando não há timestamps
  (`_segments_from_text`); `[]` sem diarização (UI oculta a seção).
- **Follow-up**: **sob demanda** (não no pipeline) — botão na aba dispara action
  `GENERATE_FOLLOWUP` via `send_command_to_python`; `generate_followup_email` gera do
  JSON estruturado; evento `FOLLOWUP_GENERATED` é interceptado no Rust que persiste
  `email_draft` no `structured_summary` (read-modify-write) e segue para a UI.
- **Persistência**: `chapters`/`participation`/`email_draft` e `metadata.language`
  entram no dict `structured` → auto-save existente no Rust persiste tudo sem mudança
  de schema SQL. `SCHEMA_VERSION` 2→3; a UI se guia por presença dos campos.
- **Reprocess**: `reprocess_meeting` (Rust) agora envia também `transcript_segments`
  persistidos (senão capítulos/participação voltariam degradados) e o `language`
  extraído de `metadata.language` — o que também **fecha o follow-up pendente do
  item 2a**: `useTranscription` captura `language` do `TRANSCRIPTION_COMPLETED` e o
  reprocessamento reenvia o idioma automaticamente.
- **UI**: `BriefingDashboard` (`src/features/briefing/`) — capítulos clicáveis
  (reusa `viewEvidence`), barras de participação em CSS puro (sem lib de gráficos),
  reuso do `FollowUpColumn` para riscos/perguntas, card de e-mail com copiar/regenerar,
  empty state para reuniões antigas sugerindo Reprocess. Aba "Briefing" entre
  Transcript e Summary no `ExpandedView`.

### b) Aba de Actions/Tasks
Hoje é lista estática: o checkbox do `SummaryDashboard` não tem handler e o estado não
persiste — o schema já tem `status: open|completed|cancelled`, falta ligar o clique à
persistência. Destrava: visão de tarefas agregada entre reuniões ("inbox" de pendências),
normalização de `due_date` para ISO usando `meeting_date` (o nó 1 já resolve datas),
agrupamento por assignee.

### c) Nó "crítico" de verificação
Passo final barato: dado o JSON estruturado + transcript, verificar se o tldr contradiz
algo e se algum número nas metrics não aparece nas entidades extraídas (cruzamento
determinístico com `numbers` do nó 1). Números alucinados são o erro que mais mina confiança.

---

## Roadmap priorizado (impacto ÷ esforço)

| # | Item | Status |
|---|------|--------|
| 1 | Instrução de idioma nos prompts (2a) | ✅ Implementado 2026-07-07 |
| 2 | Extrair `risks`/`open_questions`/`unresolved_topics` (1a) | ✅ Implementado 2026-07-07 |
| 3 | Renderizar `summary_points` na UI + contrato no prompt (2f) | ✅ Implementado 2026-07-07 |
| 4 | Saída estruturada nativa (1c) + idioma detectado (2a) + rubrica de confiança (2c/1g/2e) | ✅ Implementado 2026-07-07 |
| 5 | Match fuzzy na validação de evidência (1b) | ✅ Implementado 2026-07-07 |
| 6 | Aba Briefing: capítulos + participação + follow-up (3a) + fix `language` no reprocess (2a) | ✅ Implementado 2026-07-08 |
| 7 | Continuidade entre reuniões via RAG (3a) | ✅ Implementado 2026-07-08 |

> **Roadmap concluído (2026-07-08):** itens 1–7 implementados.
>
> **Item 7 — decisões de implementação:**
> - **Sob demanda + persistência**: botão "Analyze continuity" na aba Briefing
>   (padrão do follow-up): action `ANALYZE_CONTINUITY` → evento
>   `CONTINUITY_GENERATED` → Rust persiste `continuity` no `structured_summary`
>   (read-modify-write) → UI recarrega. Botão Re-analyze.
> - **Fluxo de dados em 1 round-trip**: o frontend (único com todos os
>   `structured_summary` em memória) envia até 15 reuniões anteriores compactadas
>   (`compactSummaryForContinuity`); o Python usa o RAG **só para ranquear**
>   (`rank_previous_meetings`: soma de scores de `query_similarity` por meeting_id,
>   fallback por recência se RAG offline) e seleciona 3.
> - **Anti-alucinação por construção**: `related_meetings` NÃO vem do LLM (montado
>   da seleção determinística); ids citados nos itens são sanitizados contra o
>   conjunto permitido; pré-passe determinístico (`find_recurring_open_actions` /
>   `find_recurring_topics` com `_continuity_similarity`, média char+token a 0.8)
>   entra como hints no prompt e é o fallback final se o parse falhar.
> - **Sem histórico**: curto-circuito sem LLM/RAG; a UI mostra "first meeting on
>   this topic".
> - De carona: fix do `INDEX_MEETING` (App.tsx) — o índice RAG agora recebe
>   title/date reais persistidos, não sintéticos (reuniões antigas se corrigem via
>   backfill existente).
>
> **Verificação do item 7:** 68 testes Python no total (9 novos: recorrência fuzzy
> com first_seen correto, completed/dissimilar/malformado ignorados, tópicos
> tags+fuzzy, ranking por score com fallback por recência, structured path com
> related determinístico, sanitização de ids alucinados, fallback com hints),
> `clippy` limpo, build TS/Vite ok, e E2E real contra Ollama (`llama3:latest`, pt):
> decisão revertida Postgres→SQLite detectada com `previous_meeting_id` correto e
> nota em português, ação recorrente "Atualizar a documentação" ×3 com
> `first_seen_meeting_id` correto, tópicos recorrentes capturados.
>
> **Extensões futuras (fora do roadmap original):**
> - Habilitar follow-up/continuidade para a sessão ao vivo (hoje requerem reunião
>   salva; seria preciso capturar `saved_meeting_id` do `NOTES_GENERATED` no
>   `useSummary`).
> - Itens ainda abertos das seções 1–3: limpeza determinística opcional do nó 2
>   (1d), consolidação real no map-reduce com paralelismo (1e), temperatura por nó
>   (1f), few-shot no nó 3 (2b), critérios para `engagement_level`/`trend` (2d),
>   persistência do checkbox de actions + visão agregada de tarefas (3b), nó
>   crítico de verificação de números (3c).
