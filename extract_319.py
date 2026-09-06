import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

transcript_path = r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\.system_generated\logs\transcript_full.jsonl"
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        if '"step_index":319' in line:
            data = json.loads(line)
            calls = data.get("tool_calls", [])
            for c in calls:
                code = c.get("args", {}).get("CodeContent", "")
                print(f"Step 319 CodeContent length: {len(code)}")
                with open("index_step_319.html", "w", encoding="utf-8") as out:
                    out.write(code)
                print("Saved to index_step_319.html")
