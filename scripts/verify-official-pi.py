"""Engineering-only fixed Pi archive check. Never imports, extracts or edits SDK code."""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import tarfile
import urllib.error
import urllib.parse
import urllib.request

VERSION = "1.4.0"
PACKAGES = ["@earendil-works/" + name for name in (
    "pi-coding-agent", "pi-agent-core", "pi-ai", "pi-codemode", "pi-mcp", "pi-tui", "pi-telemetry"
)]
MAX_ARCHIVE_BYTES = 50 * 1024 * 1024


def compare_archive(payload, installed):
    installed = Path(installed).absolute()
    changed, missing, extra, symlinks, expected = [], [], [], [], set()
    result = {"filesCompared": 0, "changed": changed, "missing": missing,
              "extraNonDependencyFiles": extra, "symlinks": symlinks}
    for parent in (installed, *installed.parents):
        if parent.is_symlink():
            symlinks.append(str(parent))
    if symlinks or not installed.is_dir():
        if not installed.is_dir():
            missing.append(".")
        return {**result, "ok": False}
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
        for member in archive:
            raw_parts = member.name.rstrip("/").split("/")
            if (not raw_parts or raw_parts[0] != "package" or
                    any(part in ("", ".", "..") for part in raw_parts) or
                    "\\" in member.name or PurePosixPath(member.name).is_absolute()):
                raise ValueError("unsafe_archive_member")
            if member.isdir():
                continue
            if not member.isfile() or len(raw_parts) < 2:
                raise ValueError("unsupported_archive_member")
            relative = PurePosixPath(*raw_parts[1:])
            name = str(relative)
            if name in expected:
                raise ValueError("duplicate_archive_member")
            expected.add(name)
            result["filesCompared"] += 1
            target = installed
            linked = False
            for part in relative.parts:
                target = target / part
                if target.is_symlink():
                    symlinks.append(str(target.relative_to(installed)))
                    linked = True
                    break
            if linked:
                continue
            if not target.is_file():
                missing.append(name)
                continue
            original = archive.extractfile(member).read()
            if hashlib.sha256(original).digest() != hashlib.sha256(target.read_bytes()).digest():
                changed.append(name)
    for directory, directories, files in os.walk(installed, followlinks=False):
        for name in list(directories):
            entry = Path(directory) / name
            if entry.is_symlink():
                symlinks.append(str(entry.relative_to(installed)))
                directories.remove(name)
            elif name == "node_modules":
                directories.remove(name)
        for name in files:
            entry = Path(directory) / name
            relative = str(entry.relative_to(installed))
            if entry.is_symlink():
                symlinks.append(relative)
            if relative not in expected:
                extra.append(relative)
    result["symlinks"] = sorted(set(symlinks))
    result["ok"] = not any((changed, missing, extra, symlinks))
    return result


def download(url, limit):
    with urllib.request.urlopen(url, timeout=25) as response:
        final = urllib.parse.urlsplit(response.geturl())
        if final.scheme != "https" or final.hostname != "registry.npmjs.org":
            raise ValueError("non_official_download_origin")
        payload = response.read(limit + 1)
    if len(payload) > limit:
        raise ValueError("official_material_too_large")
    return payload


def verify_official(root, output):
    root, output = Path(root).resolve(), Path(output).absolute()
    if output.exists():
        raise ValueError("refusing_to_overwrite_verification_receipt")
    if output.is_relative_to(root / "node_modules"):
        raise ValueError("receipt_must_not_write_installation")
    output.parent.mkdir(parents=True, exist_ok=True)
    lock = json.loads((root / "package-lock.json").read_text())
    manifest = json.loads((root / "package.json").read_text())
    results = []
    for package in PACKAGES:
        item = {"package": package, "version": VERSION, "status": "FAIL"}
        try:
            if manifest.get("dependencies", {}).get(PACKAGES[0]) != VERSION:
                raise ValueError("sdk_declaration_not_fixed_1_4_0")
            entry = lock["packages"]["node_modules/" + package]
            short = package.split("/")[-1]
            tarball = f"https://registry.npmjs.org/{package}/-/{short}-{VERSION}.tgz"
            if entry.get("version") != VERSION or entry.get("resolved") != tarball or entry.get("link"):
                raise ValueError("locked_package_is_not_fixed_official_1_4_0")
            metadata_url = "https://registry.npmjs.org/" + urllib.parse.quote(package, safe="") + "/" + VERSION
            metadata_bytes = download(metadata_url, 2 * 1024 * 1024)
            metadata = json.loads(metadata_bytes)
            if (metadata.get("name") != package or metadata.get("version") != VERSION or
                    metadata.get("dist", {}).get("tarball") != tarball or
                    metadata.get("dist", {}).get("integrity") != entry.get("integrity")):
                raise ValueError("official_metadata_and_lock_disagree")
            payload = download(tarball, MAX_ARCHIVE_BYTES)
            integrity = "sha512-" + base64.b64encode(hashlib.sha512(payload).digest()).decode()
            if integrity != entry["integrity"]:
                raise ValueError("official_archive_integrity_failed")
            material = output.parent / "official-archives"
            material.mkdir(exist_ok=True)
            (material / (short + "-" + VERSION + ".tgz")).write_bytes(payload)
            (material / (short + "-" + VERSION + ".metadata.json")).write_bytes(metadata_bytes)
            comparison = compare_archive(payload, root / "node_modules" / package)
            item.update({"registryMetadata": metadata_url, "resolved": tarball, "integrity": integrity,
                         "tarballIntegrityMatchesLockAndRegistry": True, **comparison,
                         "status": "PASS" if comparison["ok"] else "FAIL"})
        except (urllib.error.URLError, TimeoutError) as error:
            item.update({"status": "UNKNOWN", "error": type(error).__name__, "reason": "official_network_material_unavailable"})
        except (ValueError, KeyError, OSError, tarfile.TarError) as error:
            item.update({"status": "FAIL", "error": type(error).__name__, "reason": str(error)})
        results.append(item)
        print(f"{package}@{VERSION}: {item['status']}; files={item.get('filesCompared', 0)}; "
              f"changed={len(item.get('changed', []))} missing={len(item.get('missing', []))} "
              f"extra={len(item.get('extraNonDependencyFiles', []))} symlinks={len(item.get('symlinks', []))}", flush=True)
    success = len(results) == 7 and all(item["status"] == "PASS" for item in results)
    output.write_text(json.dumps({"scope": "Specified candidate installation only; seven fixed official Pi packages; no service/peer attestation",
                                  "root": str(root), "status": "PASS" if success else "NOT_PASSED", "packages": results}, indent=2) + "\n")
    return success


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".")
    parser.add_argument("--output", required=True, help="New engineering receipt path; existing receipt is never overwritten")
    arguments = parser.parse_args()
    raise SystemExit(0 if verify_official(arguments.root, arguments.output) else 1)
