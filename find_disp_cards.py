import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

transcript_path = r"C:\Users\Krishna Kumar\.gemini\antigravity\brain\a463d1dc-3792-4518-a129-16aa7676517f\.system_generated\logs\transcript_full.jsonl"
with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
    for line in f:
        if 'disp-active-fleet' in line and '<div' in line:
            idx = line.find('disp-active-fleet')
            print("Found disp-active-fleet in line:")
            print(line[max(0, idx-200):min(len(line), idx+500)])
            break
