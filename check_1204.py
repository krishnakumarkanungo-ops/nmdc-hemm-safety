import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

transcript_path = r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\.system_generated\logs\transcript_full.jsonl"
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        if '"step_index":1204' in line:
            data = json.loads(line)
            for c in data.get("tool_calls", []):
                print("Step 1204 tool:", c.get("name"))
                print(c.get("args", {}).get("Instruction"))
                print("TargetContent:", c.get("args", {}).get("TargetContent"))
                print("ReplacementContent:", c.get("args", {}).get("ReplacementContent"))
