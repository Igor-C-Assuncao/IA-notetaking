# 🎙️ IA NoteTaking 

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)
[![Tauri](https://img.shields.io/badge/Tauri-App-FFC131?logo=tauri&logoColor=white)](https://tauri.app/)
[![Python](https://img.shields.io/badge/Python-Backend-3776AB?logo=python&logoColor=white)](https://www.python.org/)

**IA NoteTaking ** é um Notetaker de IA open-source, invisível e focado em privacidade. Ele captura o áudio do seu microfone e do sistema (loopback) durante reuniões para gerar transcrições e resumos precisos, sem a necessidade de adicionar "bots" nas suas chamadas (Zoom, Meet, Teams).

Construído com uma arquitetura híbrida de alta performance (**Tauri + Rust + Python**) e utilizando padrões de engenharia de software rigorosos para facilitar a contribuição da comunidade.

## ✨ Principais Funcionalidades

* **Captura Invisível (Loopback):** Grava o áudio do sistema e do microfone nativamente, sem bots invasivos nas salas de reunião.
* **Privacidade em Primeiro Lugar (Local-First):** Suporte nativo para rodar modelos de linguagem 100% locais via **Ollama**, garantindo que dados corporativos sensíveis nunca saiam da sua máquina.
* **Traga Sua Própria Chave (BYOK):** Não quer rodar localmente? Insira suas chaves de API nas configurações e utilize modelos state-of-the-art (OpenAI, Google Gemini, Anthropic).
* **Pipeline de IA Inteligente:** Utiliza **Silero VAD** para detecção de atividade de voz (poupando processamento) e **LangGraph** para orquestrar agentes que extraem *Action Items* e decisões tomadas.
* **Multiplataforma:** Suporte planejado para Windows (WASAPI) e macOS (ScreenCaptureKit).

## 🏗️ Arquitetura

O projeto adota uma arquitetura modular baseada em Sidecar:

1. **Frontend (React/Vue/Svelte):** Interface minimalista e leve.
2. **Core (Tauri / Rust):** Gerencia o ciclo de vida do app, permissões do SO e persistência de dados local (SQLite).
3. **Motor de Áudio & IA (Python Sidecar):** Um processo Python isolado que lida com a captura de loopback, VAD, transcrição (WhisperX) e comunicação com LLMs. A comunicação com o Tauri é feita via IPC (Inter-Process Communication).

A base de código implementa padrões de projeto como **Strategy** (para alternar facilmente entre provedores de LLM) e **Observer** (para reatividade da UI durante a gravação).

## 🧩 Padrões de Projeto (Design Patterns)

Para garantir que o código seja escalável, testável e fácil para a comunidade contribuir, adotamos ativamente os seguintes padrões de engenharia de software:

* **Strategy Pattern (Padrão Estratégia):** Utilizado no núcleo do sistema BYOK (Bring Your Own Key). A aplicação possui uma interface comum `LLMProvider`. Dependendo da configuração do usuário, instanciamos diferentes estratégias em tempo de execução, como `OllamaStrategy` (local), `GeminiStrategy` ou `OpenAIStrategy` (cloud), sem alterar a lógica de negócios do notetaking.
  
* **Factory Method (Método Fábrica):** Aplicado na inicialização da captura de áudio. Como o acesso a hardware difere radicalmente entre sistemas, uma `AudioCaptureFactory` avalia o sistema operacional (Windows ou macOS) e instancia a classe correta (`WASAPICapture` ou `ScreenCaptureKitAdapter`), encapsulando a complexidade do SO.

* **Observer / Pub-Sub Pattern (Observador):** Fundamental para a reatividade da interface. O motor de áudio em Python (produtor) emite eventos de estado via IPC, como `VAD_SPEECH_DETECTED` ou `TRANSCRIPTION_PROGRESS`. O frontend no Tauri (observador) escuta esses eventos e atualiza a interface gráfica em tempo real (ex: mudando o ícone da bandeja de "Ocioso" para "Gravando").

* **Pipeline / Chain of Responsibility (Cadeia de Responsabilidade):**
  Usado no processamento do fluxo de áudio para texto. O dado bruto passa por uma cadeia sequencial e modular: `Audio Mixer` -> `Silero VAD (Corte de Silêncio)` -> `WhisperX (Transcrição)` -> `LangGraph Agent (Extração e Resumo)`. Cada nó tem uma única responsabilidade e pode ser modificado ou trocado sem quebrar o pipeline.

## 🚀 Como Começar (Ambiente de Desenvolvimento)

### Pré-requisitos
* [Node.js](https://nodejs.org/) (v18+)
* [Rust](https://www.rust-lang.org/tools/install)
* [Python](https://www.python.org/) (3.10+) e gerenciador de pacotes (`uv` ou `poetry`)

### Instalação

1. Clone o repositório:
   ```bash
   git clone [https://github.com/Igor-C-Assuncao/IA-notetaking.git](https://github.com/Igor-C-Assuncao/IA-notetaking.git)]
   cd seu-projeto
   ```
 
 2. Instale as dependências do Frontend e Rust:

```Bash
npm install
Configure o ambiente Python (Backend):
```

```Bash
cd src-python
pip install -r requirements.txt # ou utilize poetry/uv

```
3. Inicie o ambiente de desenvolvimento:

```Bash
npm run tauri dev
```
🗺️ Roadmap
Nosso desenvolvimento é dividido em Sprints. Confira o que vem por aí:

Sprint 1: Setup da ponte IPC (Tauri <-> Python)

Sprint 2: Motor de captura de áudio (Windows Loopback / macOS ScreenCaptureKit)

Sprint 3: Integração VAD, WhisperX e orquestração de Agentes

Sprint 4: Interface BYOK, armazenamento local e configurações de usuário

Sprint 5: CI/CD, testes e Release v1.0

🤝 Contribuindo
Contribuições são extremamente bem-vindas! Se você é apaixonado por IA, desenvolvimento desktop ou engenharia de áudio, veja nosso CONTRIBUTING.md para entender como configurar seu ambiente e enviar seu primeiro Pull Request.

📄 Licença
Este projeto está licenciado sob a Apache License 2.0 - veja o arquivo LICENSE para mais detalhes.


Com o repositório e a documentação base prontos, a verdadeira engenharia começa na comunicação entre a casca (Tauri/Rust) e o cérebro (Python). 

Você quer que eu construa agora o código do **Card 1.4** mostrando como enviar mensagens do Python
