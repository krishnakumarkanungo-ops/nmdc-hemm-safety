import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

transcript_path = r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\.system_generated\logs\transcript.jsonl"
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        data = json.loads(line)
        step = data.get("step_index")
        calls = data.get("tool_calls", [])
        for c in calls:
            content = str(c.get("args", {}))
            if "main-sidebar" in content and ("write_to_file" in c.get("name") or "replace_file_content" in c.get("name")):
                # Check if it has the closing </aside>
                if "</aside>" in content:
                    print(f"Found full aside in step {step}")
                    # Extract the aside block
                    start = content.find("<aside")
                    end = content.find("</aside>") + len("</aside>")
                    print(content[start:end])
                    break
