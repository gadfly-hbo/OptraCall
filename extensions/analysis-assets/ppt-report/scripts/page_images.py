#!/usr/bin/env python3
"""Render a .pptx to per-page images (full + thumbnail) via LibreOffice.

Gates: valid zip with slide XMLs before conversion, and PDF page count
== slide count after conversion. soffice silently converts invalid
files, so these gates are mandatory. Requires soffice and pypdfium2.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import zipfile

SOFFICE_CANDIDATES = [
    os.environ.get('SOFFICE'),
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    shutil.which('soffice'),
]


def find_soffice():
    for path in SOFFICE_CANDIDATES:
        if path and os.path.exists(path):
            return path
    return None


def slide_count(deck_path):
    try:
        with zipfile.ZipFile(deck_path) as z:
            bad = z.testzip()
            if bad:
                raise ValueError(f'corrupt zip entry: {bad}')
            return len([n for n in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml', n)])
    except zipfile.BadZipFile as exc:
        raise ValueError(f'not a valid pptx (zip): {exc}') from exc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--deck', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--width', type=int, default=1280)
    ap.add_argument('--thumb-width', type=int, default=320)
    args = ap.parse_args()

    try:
        expected = slide_count(args.deck)
    except ValueError as exc:
        print(f'GATE_FAIL: {exc}', file=sys.stderr)
        return 2
    if expected == 0:
        print('GATE_FAIL: deck contains no slides', file=sys.stderr)
        return 2

    soffice = find_soffice()
    if not soffice:
        print('ERROR: soffice not found (install LibreOffice or set SOFFICE)', file=sys.stderr)
        return 3
    try:
        import pypdfium2 as pdfium
    except ImportError:
        print('ERROR: pypdfium2 not available in this python environment', file=sys.stderr)
        return 3

    os.makedirs(args.out, exist_ok=True)
    pdf_dir = os.path.join(args.out, '.pdf')
    os.makedirs(pdf_dir, exist_ok=True)
    proc = subprocess.run(
        [soffice, '--headless', '--convert-to', 'pdf', '--outdir', pdf_dir, os.path.abspath(args.deck)],
        capture_output=True, text=True, timeout=300,
    )
    stem = os.path.splitext(os.path.basename(args.deck))[0]
    pdf_path = os.path.join(pdf_dir, stem + '.pdf')
    if proc.returncode != 0 or not os.path.exists(pdf_path):
        print(f'ERROR: conversion failed (rc={proc.returncode}): {proc.stderr[-400:]}', file=sys.stderr)
        return 4

    pdf = pdfium.PdfDocument(pdf_path)
    if len(pdf) != expected:
        print(f'GATE_FAIL: pdf pages {len(pdf)} != slide count {expected} (input likely invalid)', file=sys.stderr)
        return 5

    for i in range(expected):
        page = pdf[i]
        w, h = page.get_size()
        full = page.render(scale=args.width / w).to_pil()
        full.save(os.path.join(args.out, f'slide-{i+1:02d}.png'))
        full.resize((args.thumb_width, max(1, int(args.thumb_width * h / w)))).save(os.path.join(args.out, f'thumb-{i+1:02d}.png'))
    print(f'OK: {expected} pages rendered to {args.out} (width={args.width}, thumb={args.thumb_width})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
