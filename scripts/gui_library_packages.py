from __future__ import annotations

import hashlib
import io
import json
import re
import tempfile
import uuid
import zipfile
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, urlparse

import gui_annotations
import gui_library
import gui_memory


PACKAGE_FORMAT = "cark-paper-package"
PACKAGE_VERSION = 1
MAX_PACKAGE_BYTES = 512 * 1024 * 1024
MAX_UNPACKED_BYTES = 1024 * 1024 * 1024
ANNOTATION_ID_RE = re.compile(r"^annotation-[A-Za-z0-9_-]+$")


def _read_manifest(archive: zipfile.ZipFile) -> dict[str, object]:
    try:
        info = archive.getinfo("manifest.json")
    except KeyError as error:
        raise ValueError("文献包缺少 manifest.json") from error
    if info.file_size > 32 * 1024 * 1024:
        raise ValueError("文献包清单过大")
    try:
        payload = json.loads(archive.read(info).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("文献包清单无法解析") from error
    if not isinstance(payload, dict):
        raise ValueError("文献包清单无效")
    if payload.get("format") != PACKAGE_FORMAT or payload.get("version") != PACKAGE_VERSION:
        raise ValueError("文献包格式或版本不受支持")
    return payload


def _validate_package(payload: dict[str, object], archive: zipfile.ZipFile) -> tuple[dict[str, object], list[dict[str, object]]]:
    paper = payload.get("paper")
    if not isinstance(paper, dict):
        raise ValueError("文献包缺少论文数据")
    summary = paper.get("summary")
    detail = paper.get("detail")
    annotations = paper.get("annotations")
    reading_state = paper.get("readingState")
    if not isinstance(summary, dict) or not isinstance(detail, dict):
        raise ValueError("文献包论文数据无效")
    if not isinstance(summary.get("id"), str) or not isinstance(summary.get("title"), str):
        raise ValueError("文献包论文身份无效")
    if summary.get("id") != detail.get("id"):
        raise ValueError("文献包论文身份不一致")
    markdown = detail.get("markdown")
    if not isinstance(markdown, dict) or not str(markdown.get("linearized") or "").strip():
        raise ValueError("文献包缺少论文正文")
    if not isinstance(annotations, list) or not isinstance(reading_state, dict):
        raise ValueError("文献包阅读数据不完整")
    assets = payload.get("assets")
    if not isinstance(assets, list):
        raise ValueError("文献包资源清单无效")

    total_unpacked = sum(item.file_size for item in archive.infolist())
    if total_unpacked > MAX_UNPACKED_BYTES:
        raise ValueError("文献包解压后超过 1 GB，拒绝导入")

    validated_assets: list[dict[str, object]] = []
    for raw_asset in assets:
        if not isinstance(raw_asset, dict):
            raise ValueError("文献包资源项无效")
        package_path = raw_asset.get("path")
        expected_hash = raw_asset.get("sha256")
        source_url = raw_asset.get("url")
        if not all(isinstance(item, str) and item for item in (package_path, expected_hash, source_url)):
            raise ValueError("文献包资源项缺少字段")
        if not package_path.startswith("assets/") or ".." in Path(package_path).parts:
            raise ValueError("文献包包含非法资源路径")
        try:
            data = archive.read(package_path)
        except KeyError as error:
            raise ValueError(f"文献包缺少资源：{package_path}") from error
        if hashlib.sha256(data).hexdigest() != expected_hash:
            raise ValueError(f"文献包资源校验失败：{package_path}")
        validated_assets.append({**raw_asset, "_bytes": data})
    return paper, validated_assets


def _safe_artifact_path(source_url: str, package_path: str) -> Path:
    parsed = urlparse(source_url)
    relative = parse_qs(parsed.query).get("path", [""])[0].replace("\\", "/").lstrip("/")
    if relative.startswith("auto/") and ".." not in Path(relative).parts:
        return Path(relative)
    suffix = Path(package_path).suffix or ".bin"
    return Path("auto") / "images" / f"asset-{hashlib.sha256(source_url.encode('utf-8')).hexdigest()[:16]}{suffix}"


def _write_import_tree(
    root_dir: Path,
    paper: dict[str, object],
    assets: list[dict[str, object]],
) -> None:
    summary = paper["summary"]
    detail = paper["detail"]
    assert isinstance(summary, dict) and isinstance(detail, dict)
    markdown = detail["markdown"]
    assert isinstance(markdown, dict)

    auto_dir = root_dir / "auto"
    auto_dir.mkdir(parents=True, exist_ok=False)
    (auto_dir / "paper_linearized.md").write_text(str(markdown["linearized"]), encoding="utf-8")
    bilingual = str(markdown.get("bilingual") or "").strip()
    if bilingual:
        (auto_dir / "paper_linearized_bilingual.md").write_text(bilingual, encoding="utf-8")
    metadata = {
        "title": str(summary["title"]).strip(),
        "sourceFileName": "imported.carkpaper",
        "artifactStem": "paper",
        "translationStatus": "succeeded" if bilingual else "not_requested",
        "importedFromPackage": True,
    }
    (auto_dir / "paper_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    resolved_root = root_dir.resolve()
    for asset in assets:
        relative = _safe_artifact_path(str(asset["url"]), str(asset["path"]))
        target = (root_dir / relative).resolve()
        if resolved_root not in target.parents:
            raise ValueError("文献包资源目标路径非法")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(asset["_bytes"])


def _restore_annotations(record: Any, memory_root: Path, annotations: object) -> None:
    if not isinstance(annotations, list):
        return
    gui_annotations.ensure_annotations_dir(record, memory_root)
    for item in annotations:
        if not isinstance(item, dict):
            continue
        annotation_id = str(item.get("id") or "")
        if not ANNOTATION_ID_RE.fullmatch(annotation_id):
            continue
        normalized = gui_annotations.normalize_annotation_thread({**item, "paperId": record.paper_id})
        gui_memory.write_json_file(
            gui_annotations.annotation_file_path(record, memory_root, annotation_id),
            normalized,
        )


def import_paper_package(
    data: bytes,
    *,
    runtime_output_dir: Path,
    memory_root: Path,
    store: Any,
    sync_paper_index: Callable[[], None],
    get_record: Callable[[str], Any],
    encode_paper_id: Callable[[str | None, str], str],
    refresh_record_search_index: Callable[[Any], None],
    build_paper_summary: Callable[[Any], dict[str, object]],
    current_timestamp_iso: Callable[[], str],
) -> dict[str, object]:
    if not data:
        raise ValueError("文献包为空")
    if len(data) > MAX_PACKAGE_BYTES:
        raise ValueError("文献包超过 512 MB，拒绝导入")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as error:
        raise ValueError("文献包已损坏或不是有效的 .carkpaper 文件") from error

    with archive:
        paper, assets = _validate_package(_read_manifest(archive), archive)
        summary = paper["summary"]
        assert isinstance(summary, dict)
        title = str(summary["title"]).strip()
        if not title:
            raise ValueError("文献包论文标题为空")

        task_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"cark-paper:{summary['id']}"))
        destination = runtime_output_dir / task_id / "imported"
        if destination.exists():
            sync_paper_index()
            existing = get_record(encode_paper_id(task_id, title))
            return build_paper_summary(existing)
        import_root = runtime_output_dir.parent / "imports"
        import_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="cark-library-", dir=import_root) as temp_dir:
            staged_root = Path(temp_dir) / "imported"
            _write_import_tree(staged_root, paper, assets)
            destination.parent.mkdir(parents=True, exist_ok=True)
            staged_root.replace(destination)

    sync_paper_index()
    imported_id = encode_paper_id(task_id, title)
    record = get_record(imported_id)
    _restore_annotations(record, memory_root, paper.get("annotations"))

    reading_state = paper.get("readingState")
    if isinstance(reading_state, dict):
        store.save_reading_state(
            record.paper_id,
            {**reading_state, "paperId": record.paper_id},
            current_timestamp_iso(),
        )
    gui_library.update_library_meta(
        record,
        memory_root,
        {
            "favorite": bool(summary.get("favorite")),
            "tags": summary.get("tags") if isinstance(summary.get("tags"), list) else [],
            "readingStatus": summary.get("readingStatus"),
        },
    )
    refresh_record_search_index(record)
    return build_paper_summary(record)
