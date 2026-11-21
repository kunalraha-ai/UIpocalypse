#!/usr/bin/env python3
"""Pre-send secret scan of a release tarball. Prints hit counts and file
names ONLY — never secret values. Needles come from the operator's real
config files, so nothing sensitive may reach stdout."""
import re
import sys
import tarfile
import tempfile
import os
import pathlib

TARBALL = sys.argv[1]
CONFIGS = [os.path.expanduser('~/.uipocalypse/config'), 'uipocalypse/.env']

# ---- build needles from the real config files (values never printed) ----
needles = {}  # value -> label (label is safe to print)
account_id = None
for path in CONFIGS:
    if not os.path.exists(path):
        continue
    for line in open(path):
        m = re.match(r'\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$', line)
        if not m:
            continue
        key, val = m.group(1), m.group(2)
        if key == 'LLM_API_KEY' and len(val) >= 8:
            needles[val] = 'LLM_API_KEY value'
        if key == 'LLM_BASE_URL' and len(val) >= 8:
            needles[val] = 'LLM_BASE_URL value'
            m2 = re.search(r'/accounts/([0-9a-f]{16,})', val)
            if m2:
                account_id = m2.group(1)
                needles[account_id] = 'Cloudflare account ID'

# ---- key-shaped patterns (regex) ----
PATTERNS = {
    'openai-style key (sk-...)': re.compile(rb'sk-[A-Za-z0-9]{16,}'),
    'stripe live/test key': re.compile(rb'(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}'),
    'JWT (eyJ...)': re.compile(rb'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}'),
    'long hex token (40+)': re.compile(rb'\b[0-9a-f]{40,}\b'),
    'long base64 blob (50+)': re.compile(rb'\b[A-Za-z0-9+/]{50,}={0,2}\b'),
    'home-dir path': re.compile(rb'/home/[A-Za-z0-9_-]+'),
    'Users path (mac)': re.compile(rb'/Users/[A-Za-z0-9_-]+'),
    'cloudflare accounts URL': re.compile(rb'cloudflare\.com/client/v4/accounts/'),
}

# ---- extract and scan ----
tmp = tempfile.mkdtemp(prefix='/tmp/opencode/presend-scan-')
with tarfile.open(TARBALL) as t:
    t.extractall(tmp, filter='data')

hits = []
for root, _, files in os.walk(tmp):
    for name in files:
        full = os.path.join(root, name)
        rel = os.path.relpath(full, tmp)
        data = pathlib.Path(full).read_bytes()
        for needle, label in needles.items():
            n = data.count(needle.encode())
            if n:
                hits.append((rel, label, n))
        for label, pat in PATTERNS.items():
            n = len(pat.findall(data))
            if n:
                hits.append((rel, label, n))

if not hits:
    print('CLEAN — no needle or pattern hits in', tarfile.is_tarfile(TARBALL) and os.path.basename(TARBALL))
else:
    print(f'{len(hits)} hit(s):')
    for rel, label, n in sorted(hits):
        print(f'  {rel}: {label} ×{n}')
