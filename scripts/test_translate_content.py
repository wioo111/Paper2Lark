import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from translate_content import (
    split_into_chunks,
    translate_chunk,
    translate_file,
    validate_translation,
)


def completion(content):
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"choices": [{"message": {"content": content}}]}
    return response


class TranslateContentTests(unittest.TestCase):
    def test_translate_chunk_uses_structured_output_and_configured_model(self):
        content = json.dumps(
            {"block_id": "block-0001", "translation": "中文译文"},
            ensure_ascii=False,
        )

        with patch("translate_content.requests.post", return_value=completion(content)) as post:
            translated, ok = translate_chunk(
                "Original paragraph",
                "api-key",
                "https://example.test/v1",
                "custom-model",
                max_retries=1,
            )

        self.assertTrue(ok)
        self.assertEqual(translated, "Original paragraph\n\n中文译文")
        self.assertEqual(post.call_args.kwargs["json"]["model"], "custom-model")
        self.assertEqual(post.call_args.kwargs["json"]["temperature"], 0)

    def test_semantically_invalid_response_is_retried(self):
        invalid = completion(
            json.dumps({"block_id": "wrong", "translation": "中文译文"}, ensure_ascii=False)
        )
        valid = completion(
            json.dumps({"block_id": "block-0001", "translation": "中文译文"}, ensure_ascii=False)
        )

        with patch("translate_content.requests.post", side_effect=[invalid, valid]) as post, patch(
            "translate_content.time.sleep"
        ):
            translated, ok = translate_chunk(
                "Original paragraph",
                "api-key",
                "https://example.test/v1",
                "model",
                max_retries=2,
            )

        self.assertTrue(ok)
        self.assertEqual(translated, "Original paragraph\n\n中文译文")
        self.assertEqual(post.call_count, 2)
        retry_prompt = post.call_args.kwargs["json"]["messages"][1]["content"]
        self.assertIn("块 ID 不匹配", retry_prompt)

    def test_formula_or_markdown_damage_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "公式、链接或图片引用"):
            validate_translation(
                "## Result\nThe score is $x + 1$; see https://example.test/a.",
                "## 结果\n得分是 $x + 2$；参见 https://example.test/a。",
                "block-0001",
            )

    def test_inline_code_and_emphasis_damage_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "公式、链接或图片引用"):
            validate_translation(
                "Use **stable** `paper_id` values.",
                "使用 **稳定的** `paperId` 值。",
                "block-0001",
            )

    def test_code_and_image_only_blocks_are_not_sent_to_model(self):
        for block in (
            "```python\nprint('hello')\n```",
            "    print('hello')",
            "![](images/chart.png)",
            "![](images/chart.png)\n(b)",
            "$$x + y = z$$",
            "<table><tr><td>t</td><td>2δ</td><td>Δ</td></tr></table>",
            "---",
            "# BERT",
            "## 3. Video-MME",
        ):
            with patch("translate_content.requests.post") as post:
                translated, ok = translate_chunk(
                    block,
                    "api-key",
                    "https://example.test/v1",
                    "model",
                )
            self.assertTrue(ok)
            self.assertEqual(translated, block)
            post.assert_not_called()

    def test_split_does_not_merge_code_and_following_paragraph(self):
        blocks = split_into_chunks(
            "# Heading\n\n```python\nvalue = 1\n```\n\nFollowing paragraph."
        )
        self.assertEqual(
            blocks,
            ["# Heading", "```python\nvalue = 1\n```", "Following paragraph."],
        )

    def test_failed_block_does_not_publish_partial_bilingual_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "paper.md"
            output_path = Path(temp_dir) / "paper_bilingual.md"
            input_path.write_text("Original paragraph", encoding="utf-8")
            with patch.dict(os.environ, {"OPENAI_API_KEY": "key"}), patch(
                "translate_content.translate_chunk",
                return_value=("Original paragraph", False),
            ):
                with self.assertRaisesRegex(RuntimeError, "未发布双语文件"):
                    translate_file(input_path, output_path)

            self.assertFalse(output_path.exists())

    def test_structure_protection_fallback_preserves_formula(self):
        invalid = completion("not json")
        segmented = completion(
            json.dumps(
                {
                    "block_id": "block-0001",
                    "translations": {"segment-0001": "得分为"},
                },
                ensure_ascii=False,
            )
        )
        with patch(
            "translate_content.requests.post",
            side_effect=[invalid, segmented],
        ), patch("translate_content.time.sleep"):
            translated, ok = translate_chunk(
                "The score is $x$.",
                "api-key",
                "https://example.test/v1",
                "model",
                max_retries=1,
            )

        self.assertTrue(ok)
        self.assertEqual(translated, "The score is $x$.\n\n得分为 $x$.")

    def test_successful_blocks_are_reused_from_checkpoint(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "paper.md"
            output_path = Path(temp_dir) / "paper_bilingual.md"
            input_path.write_text("Original paragraph", encoding="utf-8")
            with patch.dict(os.environ, {"OPENAI_API_KEY": "key"}), patch(
                "translate_content.translate_chunk",
                return_value=("Original paragraph\n\n中文译文", True),
            ) as translate:
                translate_file(input_path, output_path)
                translate_file(input_path, output_path)

            self.assertEqual(translate.call_count, 1)
            self.assertEqual(
                output_path.read_text(encoding="utf-8"),
                "Original paragraph\n\n中文译文",
            )

    def test_checkpoint_lookup_survives_block_id_shift(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "paper.md"
            output_path = Path(temp_dir) / "paper_bilingual.md"
            input_path.write_text("First paragraph\n\nSecond paragraph", encoding="utf-8")
            with patch.dict(os.environ, {"OPENAI_API_KEY": "key"}), patch(
                "translate_content.translate_chunk",
                side_effect=[
                    ("First paragraph\n\n第一段", True),
                    ("Second paragraph\n\n第二段", True),
                ],
            ):
                translate_file(input_path, output_path)

            input_path.write_text(
                "New paragraph\n\nFirst paragraph\n\nSecond paragraph",
                encoding="utf-8",
            )
            with patch.dict(os.environ, {"OPENAI_API_KEY": "key"}), patch(
                "translate_content.translate_chunk",
                return_value=("New paragraph\n\n新增段落", True),
            ) as translate:
                translate_file(input_path, output_path)

            self.assertEqual(translate.call_count, 1)
            self.assertIn("First paragraph\n\n第一段", output_path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
