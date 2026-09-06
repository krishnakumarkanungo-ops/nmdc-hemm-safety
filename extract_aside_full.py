import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

transcript_path = r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\.system_generated\logs\transcript_full.jsonl"
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        if '"step_index":1204' in line or '"step_index":1155' in line or '"step_index":1151' in line:
            data = json.loads(line)
            step = data.get("step_index")
            for c in data.get("tool_calls", []):
                args = c.get("args", {})
                content = args.get("ReplacementContent") or args.get("CodeContent") or ""
                if "aside" in content:
                    print(f"=== STEP {step} ===")
                    print(content)
