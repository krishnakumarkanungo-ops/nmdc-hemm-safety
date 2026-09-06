import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

transcript_path = r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\.system_generated\logs\transcript_full.jsonl"
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        data = json.loads(line)
        step = data.get("step_index")
        if step in [1190, 1191, 1202, 1203]:
            print(f"=== STEP {step} ({data.get('type')}) ===")
            content = data.get("content", "")
            print(content)
