import subprocess
import time
import sys
import os
import re
import atexit

sys.stdout.reconfigure(line_buffering=True)
python_exe = sys.executable
app_dir = os.path.dirname(os.path.abspath(__file__))
cloudflared_exe = os.path.join(app_dir, 'cloudflared.exe')

print('[*] Starting HEMM Safety System Backend server on port 8000...', flush=True)
server_proc = subprocess.Popen(
    [python_exe, 'main.py'],
    cwd=app_dir
)

@atexit.register
def cleanup():
    print('[*] Cleaning up background processes...', flush=True)
    try:
        server_proc.terminate()
    except Exception:
        pass
    try:
        tunnel_proc.terminate()
    except Exception:
        pass

time.sleep(2)
print('[*] Launching Cloudflare Tunnel...', flush=True)
tunnel_proc = subprocess.Popen(
    [cloudflared_exe, 'tunnel', '--url', 'http://127.0.0.1:8000'],
    cwd=app_dir,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1
)

public_url = None
for line in iter(tunnel_proc.stdout.readline, ''):
    print(f'[Cloudflare] {line.strip()}', flush=True)
    match = re.search(r'https://[a-zA-Z0-9-]+\.trycloudflare\.com', line)
    if match:
        public_url = match.group(0)
        print('='*70, flush=True)
        print(f'[+] PUBLIC LIVE HTTPS URL: {public_url}', flush=True)
        print('='*70, flush=True)
        with open(os.path.join(app_dir, 'LIVE_URL.txt'), 'w', encoding='utf-8') as url_f:
            url_f.write(public_url + '\n')

while True:
    time.sleep(1)

