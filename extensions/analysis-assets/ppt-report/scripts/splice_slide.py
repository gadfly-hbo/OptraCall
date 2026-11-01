#!/usr/bin/env python3
"""Replace one slide of a .pptx with a single-slide replacement deck.

Every other zip entry stays byte-identical. When the replacement slide
references media through slide relationships, the related parts are
copied with new rIds and [Content_Types].xml gains the needed defaults.
The replaced slide keeps its own layout and non-media relationships.
The replacement deck must use the same slide size as the target deck.
No external dependencies.
"""
import argparse
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

R_ID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'


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



def slide_size(entries):
    pres = entries['ppt/presentation.xml'].decode('utf-8')
    m = re.search(r'<p:sldSz cx="(\d+)" cy="(\d+)"', pres)
    return (m.group(1), m.group(2)) if m else None


def load_zip(path):
    with zipfile.ZipFile(path) as z:
        return {n: z.read(n) for n in z.namelist()}


def write_zip(path, entries, order):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as out:
        seen = set()
        for name in order:
            if name in entries and name not in seen:
                out.writestr(name, entries[name])
                seen.add(name)
        for name, data in entries.items():
            if name not in seen:
                out.writestr(name, data)


def media_content_type(ext):
    return 'image/jpeg' if ext in ('jpg', 'jpeg') else f'image/{ext}'


def part_path(target):
    return ('ppt/' + target[3:]) if target.startswith('../') else ('ppt/slides/' + target)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--deck', required=True)
    ap.add_argument('--replacement', required=True)
    ap.add_argument('--slide', type=int, required=True, help='1-based slide index to replace')
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    src = load_zip(args.deck)
    rep = load_zip(args.replacement)
    target_part = f'ppt/slides/slide{args.slide}.xml'
    if target_part not in src:
        print(f'ERROR: {target_part} not found in deck', file=sys.stderr)
        return 2
    assert_editable(args.deck, args.slide)
    if slide_size(src) != slide_size(rep):
        print('ERROR: slide size mismatch; regenerate replacement at target deck sldSz', file=sys.stderr)
        return 2

    new_slide = rep['ppt/slides/slide1.xml']
    new_media = {}
    image_rels = []
    rels_name = 'ppt/slides/_rels/slide1.xml.rels'
    if rels_name in rep:
        rels = ET.fromstring(rep[rels_name])
        for rel in rels.findall(f'{{{PKG_REL_NS}}}Relationship'):
            rid = rel.get('Id')
            rtype = rel.get('Type') or ''
            target = rel.get('Target') or ''
            if not rtype.endswith('/image'):
                continue
            source_name = part_path(target).replace('ppt/slides/ppt/', 'ppt/')
            if source_name not in rep:
                print(f'ERROR: media part missing in replacement: {source_name}', file=sys.stderr)
                return 2
            media_name = f'ppt/media/spliced-{args.slide}-{rid}-{target.rsplit("/", 1)[-1]}'
            new_media[media_name] = rep[source_name]
            new_rid = f'rSpliced{args.slide}x{rid}'
            new_slide = new_slide.replace(f'{R_ID}="{rid}"'.encode(), f'{R_ID}="{new_rid}"'.encode())
            image_rels.append((new_rid, rtype, media_name.replace('ppt/', '../')))

    # The replaced slide keeps its own layout and non-media relationships.
    # Its old image/notes relationships are dropped; new media relationships
    # are appended with fresh rIds. Without such changes the original rels
    # bytes are preserved untouched.
    target_rels_name = target_part.replace('slides/', 'slides/_rels/') + '.rels'
    dropped_notes_part = None
    write_rels = bool(new_media)
    if target_rels_name in src:
        rels = ET.fromstring(src[target_rels_name])
        for rel in list(rels.findall(f'{{{PKG_REL_NS}}}Relationship')):
            rtype = rel.get('Type') or ''
            target = rel.get('Target') or ''
            if rtype.endswith('/image'):
                rels.remove(rel)
                write_rels = True
            elif rtype.endswith('/notesSlide'):
                rels.remove(rel)
                dropped_notes_part = part_path(target).replace('ppt/slides/ppt/', 'ppt/')
                write_rels = True
        for new_rid, rtype, target in image_rels:
            node = ET.SubElement(rels, f'{{{PKG_REL_NS}}}Relationship')
            node.set('Id', new_rid)
            node.set('Type', rtype)
            node.set('Target', target)
        new_rels = ET.tostring(rels, encoding='utf-8', xml_declaration=True) if write_rels else None
    elif image_rels:
        print('ERROR: target slide has no relationships file to preserve layout', file=sys.stderr)
        return 2
    else:
        new_rels = None

    out_entries = dict(src)
    out_entries[target_part] = new_slide
    out_entries.update(new_media)
    if dropped_notes_part:
        out_entries.pop(dropped_notes_part, None)
        out_entries.pop(dropped_notes_part.replace('notesSlides/', 'notesSlides/_rels/') + '.rels', None)
    if new_rels is not None:
        ET.register_namespace('', PKG_REL_NS)
        out_entries[target_rels_name] = new_rels
    if new_media:
        ct = ET.fromstring(out_entries['[Content_Types].xml'])
        existing = {d.get('Extension') for d in ct.findall(f'{{{CT_NS}}}Default')}
        for name in new_media:
            ext = name.rsplit('.', 1)[-1].lower()
            if ext not in existing:
                node = ET.SubElement(ct, f'{{{CT_NS}}}Default')
                node.set('Extension', ext)
                node.set('ContentType', media_content_type(ext))
        ET.register_namespace('', CT_NS)
        out_entries['[Content_Types].xml'] = ET.tostring(ct, encoding='utf-8', xml_declaration=True)

    write_zip(args.out, out_entries, list(src.keys()))
    print(f'OK: replaced slide {args.slide} -> {args.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
