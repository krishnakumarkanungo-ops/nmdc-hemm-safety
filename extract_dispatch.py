import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

transcript_path = r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\.system_generated\logs\transcript_full.jsonl"
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        if 'disp-active-fleet' in line and 'fleet-table-body' in line and '<div id="dispatch-twin-view"' in line:
            idx = line.find('<div id="dispatch-twin-view"')
            end_idx = line.find('</main>', idx)
            if idx != -1 and end_idx != -1:
                print("Found dispatch-twin-view:")
                snippet = line[idx:end_idx]
                snippet = snippet.replace('\\"', '"').replace('\\n', '\n')
                with open("extracted_dispatch.html", "w", encoding="utf-8") as out:
                    out.write(snippet)
                print("Saved extracted_dispatch.html, len:", len(snippet))
                break
