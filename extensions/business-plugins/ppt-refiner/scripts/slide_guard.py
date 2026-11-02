#!/usr/bin/env python3
"""Per-slide byte guard for refinement turns.

diff: list slide parts whose bytes differ between two decks.
restore: copy the given displayed pages back from the before deck, leaving
all other entries of the after deck byte-identical. A changed page mapping
requires whole-deck recovery rather than an ambiguous partial restore.
"""
import argparse
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'analysis-assets/ppt-report/scripts'))
from pptx_parts import ordered_slide_parts, relationship_part, resolve_part, slide_part


def load(path):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        if len(names) != len(set(names)):
            raise ValueError('duplicate package parts')
        entries = {n: z.read(n) for n in names}
        for name, data in entries.items():
            if name.endswith(('.xml', '.rels')):
                ET.fromstring(data)
        ordered_slide_parts(entries)
        return entries


def slide_parts(entries):
    return {part for slide in ordered_slide_parts(entries) for part in (slide, relationship_part(slide)) if part in entries}


def page_parts(entries, page):
    """Include charts/media/layouts reached by the locked slide, not just its XML."""
    result = {'[Content_Types].xml', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels'}
    pending = [slide_part(entries, page)]
    while pending:
        part = pending.pop()
        if part in result:
            continue
        result.add(part)
        rels = relationship_part(part)
        if rels not in entries:
            continue
        result.add(rels)
        for relation in ET.fromstring(entries[rels]):
            if relation.get('TargetMode') == 'External':
                continue
            target = resolve_part(part, relation.get('Target', ''))
            if target not in entries:
                raise ValueError('referenced package part is missing: ' + target)
            pending.append(target)
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('command', choices=['diff', 'restore', 'check'])
    ap.add_argument('--before', required=True)
    ap.add_argument('--after', required=True)
    ap.add_argument('--slides', default='')
    args = ap.parse_args()

    before = load(args.before)
    after = load(args.after)
    if args.command == 'check':
        changed = {n for n in before.keys() | after.keys() if before.get(n) != after.get(n)}
        pages = [int(n) for n in args.slides.split(',') if n]
        violations = [page for page in pages if changed & (page_parts(before, page) | page_parts(after, page))]
        print(json.dumps({'changedParts': sorted(changed), 'lockedPagesChanged': violations}))
        return 0
    if args.command == 'diff':
        changed = sorted(n for n in slide_parts(before) | slide_parts(after) if before.get(n) != after.get(n))
        print(json.dumps(changed))
        return 0

    parts = []
    for n in args.slides.split(','):
        if not n:
            continue
        part = slide_part(before, int(n))
        if slide_part(after, int(n)) != part:
            raise ValueError('displayed slide mapping changed; whole-deck recovery is required')
        parts.append(part)
        parts.append(relationship_part(part))
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
