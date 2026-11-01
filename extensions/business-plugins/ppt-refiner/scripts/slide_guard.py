#!/usr/bin/env python3
"""Per-slide byte guard for refinement turns.

diff: list slide parts whose bytes differ between two decks.
restore: copy the given slide parts back from the before deck, leaving
all other entries of the after deck byte-identical.
"""
import argparse
import json
import re
import sys
import zipfile


def load(path):
    with zipfile.ZipFile(path) as z:
        return {n: z.read(n) for n in z.namelist()}


def slide_parts(entries):
    return {n for n in entries if re.fullmatch(r'ppt/slides/slide\d+\.xml', n)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('command', choices=['diff', 'restore'])
    ap.add_argument('--before', required=True)
    ap.add_argument('--after', required=True)
    ap.add_argument('--slides', default='')
    args = ap.parse_args()

    before = load(args.before)
    after = load(args.after)
    if args.command == 'diff':
        changed = sorted(n for n in slide_parts(before) | slide_parts(after) if before.get(n) != after.get(n))
        print(json.dumps(changed))
        return 0

    parts = [f'ppt/slides/slide{n}.xml' for n in args.slides.split(',') if n]
    if not parts:
        print('ERROR: --slides required for restore', file=sys.stderr)
        return 2
    out = dict(after)
    for part in parts:
        if part in before:
            out[part] = before[part]
        else:
            out.pop(part, None)
    with zipfile.ZipFile(args.after + '.tmp', 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in out.items():
            z.writestr(name, data)
    import os
    os.replace(args.after + '.tmp', args.after)
    print(json.dumps({'restored': parts}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
