import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

transcript_path = r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\.system_generated\logs\transcript.jsonl"
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        data = json.loads(line)
        step = data.get("step_index", 0)
        if step < 1360:
            calls = data.get("tool_calls", [])
            for c in calls:
                args = c.get("args", {})
                txt = json.dumps(args)
                if "<aside" in txt:
                    print(f"Step {step}: tool {c.get('name')}")
                    # let's find start and end of aside
                    pos = txt.find("<aside")
                    endpos = txt.find("<\\/aside>", pos)
                    if endpos == -1:
                        endpos = txt.find("</aside>", pos)
                    if endpos != -1:
                        print("Full aside snippet:\n", txt[pos:endpos+10][:1500])
                    else:
                        print("Partial aside snippet:\n", txt[pos:pos+500])
