# src-python/main.py
import sys
import json
import time

# Internal services
from audio_capture import AudioCaptureFactory, list_audio_devices
from transcription_service import TranscriptionService
from llm_service import LLMFactory, MeetingWorkflowEngine
from langchain_core.messages import SystemMessage, HumanMessage
from rag_service import RAGService
from config import DEFAULTS

def send_event(event_type: str, payload: dict):
    """
    Observer Pattern: Emits events for Rust/Tauri to capture via stdout.
    """
    message = {"event": event_type, "data": payload}
    print(json.dumps(message))
    sys.stdout.flush()

def main():
    # Allow React time to mount and start listening to IPC events
    time.sleep(2)
    send_event("SYSTEM_READY", {"status": "Python engine is ready and listening."})
    send_event("DEVICE_LIST", {"devices": list_audio_devices()})

    current_config = {}

    # 1. Initialize Audio Capture
    try:
        audio_capturer = AudioCaptureFactory.get_strategy()
    except Exception as e:
        send_event("ERROR", {"message": f"Audio Error: {str(e)}"})
        return

    # 2. Initialize AI Transcriber (WhisperX)
    try:
        transcriber = TranscriptionService()
    except Exception as e:
        send_event("ERROR", {"message": f"Failed to initialize WhisperX: {str(e)}"})
        transcriber = None

    # 3. Initialize RAG Service
    try:
        rag_service = RAGService()
    except Exception as e:
        send_event("ERROR", {"message": f"Failed to initialize local RAG: {str(e)}"})
        rag_service = None

    # Main loop listening for IPC commands from Rust
    for line in sys.stdin:
        try:
            command = json.loads(line.strip())
            action = command.get("action")

            if action == "LIST_DEVICES":
                send_event("DEVICE_LIST", {"devices": list_audio_devices()})

            elif action == "INDEX_MEETING":
                meeting_id = command.get("meeting_id")
                title = command.get("title", "")
                date = command.get("date", "")
                raw_transcript = command.get("raw_transcript", "")
                provider = command.get("embedding_provider", "ollama")
                model_name = command.get("embedding_model", "nomic-embed-text")
                if rag_service:
                    try:
                        rag_service.index_meeting(meeting_id, title, date, raw_transcript, provider, model_name)
                    except Exception as e:
                        print(f"DEBUG: [RAG] Failed to index meeting {meeting_id}: {e}", file=sys.stderr)

            elif action == "BACKFILL_INDEX_REQUESTED":
                meetings = command.get("meetings", [])
                provider = command.get("embedding_provider", "ollama")
                model_name = command.get("embedding_model", "nomic-embed-text")
                if rag_service:
                    try:
                        rag_service.clear_index()
                        total = len(meetings)
                        indexed_count = 0
                        for idx, m in enumerate(meetings):
                            m_id = m.get("id")
                            m_title = m.get("title", "")
                            m_date = m.get("date", "")
                            m_transcript = m.get("raw_transcript", "")
                            
                            send_event("BACKFILL_STATUS", {
                                "progress": (idx + 1) / total if total > 0 else 1.0,
                                "current": idx + 1,
                                "total": total,
                                "message": f"Syncing: {idx + 1}/{total} ({m_title})"
                            })
                            
                            rag_service.index_meeting(m_id, m_title, m_date, m_transcript, provider, model_name)
                            indexed_count += 1
                            
                        send_event("BACKFILL_COMPLETED", {"success": True, "count": indexed_count})
                    except Exception as e:
                        send_event("BACKFILL_COMPLETED", {"success": False, "error": str(e)})
                else:
                    send_event("BACKFILL_COMPLETED", {"success": False, "error": "RAG Service is offline."})

            elif action == "COPILOT_QUERY":
                query = command.get("query", "")
                provider_name = command.get("provider", "ollama")
                model_name = command.get("model", "llama3")
                api_key = command.get("api_key", "")
                system_prompt = command.get("system_prompt", "")
                emb_provider = command.get("embedding_provider", "ollama")
                emb_model = command.get("embedding_model", "nomic-embed-text")
                
                if rag_service:
                    try:
                        # Step 1: Perform vector search
                        results = rag_service.query_similarity(query, emb_provider, emb_model, top_k=5)
                        
                        # Step 2: Format LLM context
                        context_str = ""
                        if results:
                            context_str = "\n".join([
                                f"--- [Meeting: {r['title']} ({r['date']})] ---\n{r['text']}"
                                for r in results
                            ])
                        else:
                            context_str = "(No relevant past meetings found in vector database.)"
                        
                        # Step 3: Set up RAG prompt
                        default_system = (
                            "You are the AI Copilot, a helpful and precise assistant for the user's meeting history.\n"
                            "Below is the relevant context retrieved from the user's past meetings to answer their query.\n"
                            "Analyze this context and answer the user query clearly and professionally.\n"
                            "CRITICAL: You must cite the meetings you reference using their title and date in bracket format like this: [Meeting Title](date).\n"
                            "If the retrieved context does not contain enough information to answer, state this clearly, but answer as best as possible."
                        )
                        
                        final_system = default_system
                        if system_prompt:
                            final_system += f"\n\nUser Custom Guidelines:\n{system_prompt}"
                        
                        final_system += f"\n\nRETRIEVED MEETING CONTEXT:\n{context_str}"
                        
                        # Step 4: Stream response from LLM
                        engine = MeetingWorkflowEngine(provider_name, model_name, api_key=api_key)
                        
                        messages = [
                            SystemMessage(content=final_system),
                            HumanMessage(content=query)
                        ]
                        
                        print("DEBUG: [Copilot] Initializing streaming response...", file=sys.stderr)
                        response_text = ""
                        for chunk in engine.llm.stream(messages):
                            content = chunk.content if hasattr(chunk, 'content') else str(chunk)
                            if content:
                                response_text += content
                                send_event("COPILOT_STREAM", {"chunk": content})
                        
                        send_event("COPILOT_COMPLETED", {"success": True, "answer": response_text})
                    except Exception as e:
                        send_event("COPILOT_COMPLETED", {"success": False, "error": str(e)})
                else:
                    send_event("COPILOT_COMPLETED", {"success": False, "error": "RAG Service is offline."})

            elif action == "REPROCESS_REQUESTED":
                send_event("PIPELINE_STATUS", {"step": "Reprocessing Notes with AI..."})
                
                meeting_id = command.get("meeting_id")
                raw_transcript = command.get("raw_transcript", "")
                system_prompt = command.get("system_prompt", "")
                provider_name = command.get("provider", "ollama")
                model_name = command.get("model", "llama3")
                api_key = command.get("api_key", "")
                structured_summary = command.get("structured_summary")
                
                try:
                    llm = LLMFactory.get_provider(provider_name, model_name)
                    result = llm.generate_notes(
                        raw_transcript,
                        api_key=api_key,
                        system_prompt=system_prompt or None,
                        diarized_segments=None,
                        meeting_date=time.strftime("%Y-%m-%d %H:%M:%S")
                    )
                    send_event("REPROCESS_COMPLETED", {
                        "meeting_id": meeting_id,
                        "markdown": result.get("markdown", ""),
                        "structured": result.get("structured", {}),
                    })
                    send_event("PIPELINE_STATUS", {"step": "Done."})
                except Exception as e:
                    send_event("ERROR", {"message": f"Reprocess LLM Error: {str(e)}"})

            elif action == "VALIDATE_NOTION":
                token = command.get("notion_token")
                db_id = command.get("notion_database_id")
                
                import urllib.request
                import urllib.error
                
                headers = {
                    "Authorization": f"Bearer {token}",
                    "Notion-Version": "2022-06-28",
                }
                
                try:
                    req = urllib.request.Request("https://api.notion.com/v1/users/me", headers=headers)
                    with urllib.request.urlopen(req) as response:
                        user_data = json.loads(response.read().decode())
                        
                    # Validate Database ID
                    req_db = urllib.request.Request(f"https://api.notion.com/v1/databases/{db_id}", headers=headers)
                    with urllib.request.urlopen(req_db) as response_db:
                        db_data = json.loads(response_db.read().decode())
                        
                    send_event("NOTION_VALIDATED", {"success": True, "workspace_name": user_data.get("workspace_name", "Notion Workspace")})
                except urllib.error.HTTPError as he:
                    try:
                        error_msg = he.read().decode()
                    except Exception:
                        error_msg = f"HTTP Error {he.code}"
                    send_event("NOTION_VALIDATED", {"success": False, "error": error_msg})
                except Exception as e:
                    send_event("NOTION_VALIDATED", {"success": False, "error": str(e)})

            elif action == "EXPORT_NOTION":
                token = command.get("notion_token")
                db_id = command.get("notion_database_id")
                title = command.get("title", "Untitled Meeting")
                date = command.get("date", "")
                tags = command.get("tags", [])
                speakers = command.get("speakers", [])
                markdown = command.get("markdown", "")
                
                import urllib.request
                import urllib.error
                
                def markdown_to_notion_blocks(markdown_text: str):
                    blocks = []
                    lines = markdown_text.split("\n")
                    for line in lines:
                        line_str = line.strip()
                        if not line_str:
                            continue
                            
                        if line_str.startswith("### "):
                            blocks.append({
                                "object": "block",
                                "type": "heading_3",
                                "heading_3": {"rich_text": [{"type": "text", "text": {"content": line_str[4:]}}]}
                            })
                        elif line_str.startswith("## "):
                            blocks.append({
                                "object": "block",
                                "type": "heading_2",
                                "heading_2": {"rich_text": [{"type": "text", "text": {"content": line_str[3:]}}]}
                            })
                        elif line_str.startswith("# "):
                            blocks.append({
                                "object": "block",
                                "type": "heading_1",
                                "heading_1": {"rich_text": [{"type": "text", "text": {"content": line_str[2:]}}]}
                            })
                        elif line_str.startswith("- ") or line_str.startswith("* "):
                            content = line_str[2:]
                            if content.startswith("[ ] ") or content.startswith("[x] "):
                                checked = content.startswith("[x]")
                                blocks.append({
                                    "object": "block",
                                    "type": "to_do",
                                    "to_do": {
                                        "rich_text": [{"type": "text", "text": {"content": content[4:]}}],
                                        "checked": checked
                                    }
                                })
                            else:
                                blocks.append({
                                    "object": "block",
                                    "type": "bulleted_list_item",
                                    "bulleted_list_item": {"rich_text": [{"type": "text", "text": {"content": content}}]}
                                })
                        else:
                            blocks.append({
                                "object": "block",
                                "type": "paragraph",
                                "paragraph": {"rich_text": [{"type": "text", "text": {"content": line_str}}]}
                            })
                    return blocks[:100]

                headers = {
                    "Authorization": f"Bearer {token}",
                    "Notion-Version": "2022-06-28",
                    "Content-Type": "application/json",
                }
                
                properties = {
                    "Name": {
                        "title": [{"text": {"content": title}}]
                    }
                }
                
                if date:
                    date_only = date.split(" ")[0]
                    properties["Date"] = {"date": {"start": date_only}}
                if tags:
                    properties["Tags"] = {"multi_select": [{"name": t[:25]} for t in tags if t]}
                if speakers:
                    properties["Participants"] = {"multi_select": [{"name": s[:25]} for s in speakers if s]}
                    
                blocks = markdown_to_notion_blocks(markdown)
                payload = {
                    "parent": {"database_id": db_id},
                    "properties": properties,
                    "children": blocks
                }
                
                try:
                    data_bytes = json.dumps(payload).encode('utf-8')
                    req = urllib.request.Request(
                        "https://api.notion.com/v1/pages", 
                        data=data_bytes, 
                        headers=headers,
                        method="POST"
                    )
                    with urllib.request.urlopen(req) as response:
                        res_data = json.loads(response.read().decode())
                        page_id = res_data.get("id", "").replace("-", "")
                        
                    send_event("NOTION_EXPORT_COMPLETED", {"success": True, "page_id": page_id})
                except urllib.error.HTTPError as he:
                    try:
                        error_msg = he.read().decode()
                    except Exception:
                        error_msg = f"HTTP Error {he.code}"
                    
                    if "schema" in error_msg.lower() or "validation" in error_msg.lower():
                        try:
                            properties = {
                                "Title": {"title": [{"text": {"content": title}}]}
                            }
                            if date:
                                properties["Date"] = {"date": {"start": date.split(" ")[0]}}
                            if tags:
                                properties["Tags"] = {"multi_select": [{"name": t[:25]} for t in tags if t]}
                            if speakers:
                                properties["Participants"] = {"multi_select": [{"name": s[:25]} for s in speakers if s]}
                                
                            payload["properties"] = properties
                            data_bytes = json.dumps(payload).encode('utf-8')
                            req = urllib.request.Request(
                                "https://api.notion.com/v1/pages", 
                                data=data_bytes, 
                                headers=headers,
                                method="POST"
                            )
                            with urllib.request.urlopen(req) as response:
                                res_data = json.loads(response.read().decode())
                                page_id = res_data.get("id", "").replace("-", "")
                            send_event("NOTION_EXPORT_COMPLETED", {"success": True, "page_id": page_id})
                            continue
                        except Exception as e2:
                            error_msg = str(e2)
                            
                    send_event("NOTION_EXPORT_COMPLETED", {"success": False, "error": error_msg})
                except Exception as e:
                    send_event("NOTION_EXPORT_COMPLETED", {"success": False, "error": str(e)})

            elif action == "START_RECORDING":
                send_event("RECORDING_STATUS", {"is_recording": True})

                # Store recording config for use when STOP_RECORDING arrives
                current_config = {
                    "system_audio": command.get("system_audio", DEFAULTS["system_audio"]),
                    "auto_summarize": command.get("auto_summarize", DEFAULTS["auto_summarize"]),
                    "speaker_diarization": command.get("speaker_diarization", DEFAULTS["speaker_diarization"]),
                    "language": command.get("language", DEFAULTS["language"]),
                    "system_prompt": command.get("system_prompt", ""),
                    "llm_provider": command.get("llm_provider", DEFAULTS["provider"]),
                    "llm_model": command.get("llm_model", DEFAULTS["model"]),
                    "api_key": command.get("api_key", ""),
                    "is_test": command.get("is_test", False),
                }

                def on_telemetry(level: float):
                    send_event("VAD_TELEMETRY", {"level": round(level, 3)})

                audio_capturer.start_recording(
                    telemetry_callback=on_telemetry,
                    system_audio=current_config.get("system_audio", False),
                )

            elif action == "STOP_RECORDING":
                send_event("RECORDING_STATUS", {"is_recording": False})
                send_event("PIPELINE_STATUS", {"step": "Processing Audio (VAD)..."})

                # STEP A: Stop recording and trim silence
                saved_file_path = audio_capturer.stop_recording()

                if current_config.get("is_test", False):
                    send_event("PIPELINE_STATUS", {"step": "Done."})
                    continue

                # STEP B: Transcribe audio
                if transcriber:
                    send_event("PIPELINE_STATUS", {"step": "Transcribing with WhisperX..."})
                    lang = current_config.get("language", "auto")
                    transcription_result = transcriber.transcribe(
                        saved_file_path,
                        language=None if lang == "auto" else lang
                    )
                    send_event("TRANSCRIPTION_COMPLETED", {
                        "text": transcription_result["text"],
                        "segments": transcription_result.get("segments"),
                        "diarized": transcription_result.get("diarized", False),
                    })

                    # STEP C: Generate Notes — only if auto_summarize is enabled
                    if not current_config.get("auto_summarize", True):
                        send_event("PIPELINE_STATUS", {"step": "Done."})
                        continue

                    send_event("PIPELINE_STATUS", {"step": "Generating Notes with AI..."})

                    provider_name = current_config.get("llm_provider", "ollama")
                    model_name = current_config.get("llm_model", "llama3")
                    api_key = current_config.get("api_key", "")
                    
                    try:
                        llm = LLMFactory.get_provider(provider_name, model_name)
                        result = llm.generate_notes(
                            transcription_result["text"],
                            api_key=api_key,
                            system_prompt=current_config.get("system_prompt", "") or None,
                            diarized_segments=transcription_result.get("segments") if transcription_result.get("diarized") else None,
                            meeting_date=time.strftime("%Y-%m-%d %H:%M:%S")
                        )
                        send_event("NOTES_GENERATED", {
                            "markdown": result.get("markdown", ""),
                            "structured": result.get("structured", {}),
                        })
                        send_event("PIPELINE_STATUS", {"step": "Done."})
                    except Exception as e:
                        send_event("ERROR", {"message": f"LLM Generation Error: {str(e)}"})
                else:
                    send_event("ERROR", {"message": "Transcriber is offline."})

        except json.JSONDecodeError:
            send_event("ERROR", {"message": "Invalid JSON command received."})
        except Exception as e:
            send_event("ERROR", {"message": f"Unexpected error: {str(e)}"})

if __name__ == "__main__":
    main()