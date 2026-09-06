import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

transcript_path = r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\.system_generated\logs\transcript.jsonl"
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        data = json.loads(line)
        step = data.get("step_index")
        if step in [1151, 1155, 1204]:
            calls = data.get("tool_calls", [])
            for c in calls:
                args = c.get("args", {})
                content = args.get("ReplacementContent", "")
                if "<aside" in content:
                    print(f"=== Step {step} ===")
                    print(content)
