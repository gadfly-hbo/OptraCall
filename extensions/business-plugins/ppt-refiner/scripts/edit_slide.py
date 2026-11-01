#!/usr/bin/env python3
"""Edit text runs of one slide in place (small refinements).

Replaces a substring inside <a:t> runs of the target slide only; every
other zip entry stays byte-identical. When --report is given, newly
introduced numeric tokens must appear verbatim in the report, otherwise
the edit is refused (anchor interception). --allow-uncovered overrides
that check for user-confirmed direct edits (to be recorded in the diff
list by the caller). No external dependencies.
"""
import argparse
import json
import os
import re
import sys
import zipfile

NUMBER = re.compile(r'[+\-]?\d[\d,]*(?:\.\d+)?%?')


def assert_editable(deck_path, slide):
    """Hard lock gate: deck meta.json lockedPages wins over any prompt."""
    meta_path = os.path.join(os.path.dirname(os.path.abspath(deck_path)), 'meta.json')
    if not os.path.exists(meta_path):
        return
    try:
        with open(meta_path, encoding='utf-8') as f:
            locked = json.load(f).get('lockedPages', [])
    except (OSError, ValueError):
        return
    if slide in locked:
        print(f'PAGE_LOCKED: slide {slide} is locked and must stay byte-identical', file=sys.stderr)
        sys.exit(5)



def load_zip(path):
    with zipfile.ZipFile(path) as z:
        return {n: z.read(n) for n in z.namelist()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--deck', required=True)
    ap.add_argument('--slide', type=int, required=True)
    ap.add_argument('--match', required=True)
    ap.add_argument('--replace', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--report')
    ap.add_argument('--allow-uncovered', action='store_true')
    args = ap.parse_args()

    src = load_zip(args.deck)
    part = f'ppt/slides/slide{args.slide}.xml'
    if part not in src:
        print(f'ERROR: {part} not found', file=sys.stderr)
        return 2
    assert_editable(args.deck, args.slide)
    xml = src[part].decode('utf-8')
    runs = re.findall(r'<a:t>([^<]*)</a:t>', xml)
    if args.match not in xml:
        preview = ' | '.join(r.strip() for r in runs if r.strip())[:600]
        print(f'ERROR: match not found on slide {args.slide}. Texts: {preview}', file=sys.stderr)
        return 3

    if args.report and not args.allow_uncovered:
        original_numbers = set()
        for run in runs:
            if args.match in run:
                original_numbers.update(NUMBER.findall(run))
        with open(args.report, encoding='utf-8') as f:
            covered = set(NUMBER.findall(f.read()))
        new_numbers = set(NUMBER.findall(args.replace)) - original_numbers
        uncovered = sorted(n for n in new_numbers if n not in covered)
        if uncovered:
            print(f"ANCHOR_REFUSED: numbers not in report: {', '.join(uncovered)}. Provide evidence or confirm direct edit with --allow-uncovered.", file=sys.stderr)
            return 4

    new_xml = xml.replace(args.match, args.replace)
    if new_xml == xml:
        print('ERROR: replacement produced no change', file=sys.stderr)
        return 3
    src[part] = new_xml.encode('utf-8')
    with zipfile.ZipFile(args.out, 'w', zipfile.ZIP_DEFLATED) as out:
        for name, data in src.items():
            out.writestr(name, data)
    print(f'OK: edited slide {args.slide} -> {args.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
