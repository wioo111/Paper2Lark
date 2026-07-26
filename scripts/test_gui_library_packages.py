import hashlib
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import gui_library_packages


def build_package() -> bytes:
    asset = b"image-bytes"
    manifest = {
        "format": "cark-paper-package",
        "version": 1,
        "createdAt": "2026-07-26T00:00:00Z",
        "paper": {
            "summary": {
                "id": "source-paper",
                "title": "Imported Paper",
                "favorite": True,
                "tags": ["迁移"],
                "readingStatus": "reading",
            },
            "detail": {
                "id": "source-paper",
                "markdown": {
                    "linearized": "# Imported Paper\n\n![](images/figure.png)",
                    "bilingual": "# Imported Paper\n\n译文",
                },
            },
            "annotations": [],
            "readingState": {
                "paperId": "source-paper",
                "view": "bilingual",
                "scrollY": 42,
                "clientRevision": 3,
            },
        },
        "assets": [
            {
                "url": "/api/media/source-paper?path=auto/images/figure.png",
                "path": "assets/0000.png",
                "contentType": "image/png",
                "sha256": hashlib.sha256(asset).hexdigest(),
            }
        ],
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("assets/0000.png", asset)
    return output.getvalue()


class GuiLibraryPackagesTests(unittest.TestCase):
    def test_import_restores_readable_artifacts_and_state(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            runtime_output = Path(temp_dir) / "runtime" / "output"
            memory_root = Path(temp_dir) / "runtime" / "memory"
            store = Mock()
            record_holder = {}

            def sync_paper_index():
                task_dir = next(path for path in runtime_output.iterdir() if path.is_dir())
                root_dir = task_dir / "imported"
                record_holder["record"] = SimpleNamespace(
                    paper_id=f"imported-{task_dir.name}",
                    title="Imported Paper",
                    task_id=task_dir.name,
                    root_dir=root_dir,
                    auto_dir=root_dir / "auto",
                    files={},
                )

            result = gui_library_packages.import_paper_package(
                build_package(),
                runtime_output_dir=runtime_output,
                memory_root=memory_root,
                store=store,
                sync_paper_index=sync_paper_index,
                get_record=lambda _paper_id: record_holder["record"],
                encode_paper_id=lambda task_id, title: f"imported-{task_id}",
                refresh_record_search_index=Mock(),
                build_paper_summary=lambda record: {"id": record.paper_id, "title": record.title},
                current_timestamp_iso=lambda: "2026-07-26T00:00:00Z",
            )

            record = record_holder["record"]
            self.assertEqual(result["title"], "Imported Paper")
            self.assertEqual((record.auto_dir / "paper_linearized.md").read_text(encoding="utf-8"), "# Imported Paper\n\n![](images/figure.png)")
            self.assertEqual((record.auto_dir / "images" / "figure.png").read_bytes(), b"image-bytes")
            store.save_reading_state.assert_called_once()
            saved_state = store.save_reading_state.call_args.args[1]
            self.assertEqual(saved_state["paperId"], record.paper_id)
            self.assertTrue((memory_root / "papers" / record.paper_id / "library_meta.json").exists())

    def test_import_rejects_tampered_asset_before_writing(self):
        data = bytearray(build_package())
        data[-8] ^= 0x01
        with tempfile.TemporaryDirectory() as temp_dir:
            runtime_output = Path(temp_dir) / "output"
            with self.assertRaises(ValueError):
                gui_library_packages.import_paper_package(
                    bytes(data),
                    runtime_output_dir=runtime_output,
                    memory_root=Path(temp_dir) / "memory",
                    store=Mock(),
                    sync_paper_index=Mock(),
                    get_record=Mock(),
                    encode_paper_id=Mock(),
                    refresh_record_search_index=Mock(),
                    build_paper_summary=Mock(),
                    current_timestamp_iso=Mock(),
                )
            self.assertFalse(runtime_output.exists())


if __name__ == "__main__":
    unittest.main()
