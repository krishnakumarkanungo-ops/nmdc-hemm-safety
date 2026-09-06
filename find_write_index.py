import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

transcript_path = r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\.system_generated\logs\transcript.jsonl"
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        data = json.loads(line)
        step = data.get("step_index", 0)
        calls = data.get("tool_calls", [])
        for c in calls:
            args = c.get("args", {})
            target = str(args.get("TargetFile", ""))
            if "index.html" in target and c.get("name") == "write_to_file":
                print(f"Step {step}: write_to_file index.html")
                code = args.get("CodeContent", "")
                if "<aside" in code:
                    p1 = code.find("<aside")
                    p2 = code.find("</aside>", p1) + len("</aside>")
                    print("Found aside in write_to_file step", step)
                    with open(f"aside_step_{step}.html", "w", encoding="utf-8") as out:
                        out.write(code[p1:p2])
                    print(f"Written aside_step_{step}.html (length: {p2-p1})")
