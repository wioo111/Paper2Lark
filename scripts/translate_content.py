import argparse
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

import requests


BLOCK_ID = "block_id"
TRANSLATION = "translation"
FENCE_RE = re.compile(r"^\s*(```|~~~)")
HEADING_RE = re.compile(r"^(\s{0,3}#{1,6}\s+)")
LIST_RE = re.compile(r"^(\s*(?:[-+*]|\d+[.)])\s+)")
QUOTE_RE = re.compile(r"^(\s*>+\s*)")
URL_RE = re.compile(r"https?://[^\s)>]+")
IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^\n)]+\)")
LINK_DESTINATION_RE = re.compile(r"(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
FULL_LINK_RE = re.compile(r"(?<!!)\[[^\]]+\]\([^\n)]+\)")
INLINE_CODE_RE = re.compile(r"`+[^`\n]+`+")
HTML_TAG_RE = re.compile(r"</?[A-Za-z][^>]*>")
STRONG_MARKER_RE = re.compile(r"(?<!\\)(?:\*\*|__|~~)")
INLINE_MATH_RE = re.compile(r"(?<!\\)\$\$.*?\$\$|(?<!\\)\$(?!\s).*?(?<!\s)\$", re.DOTALL)
LATEX_MATH_RE = re.compile(r"\\\(.*?\\\)|\\\[.*?\\\]", re.DOTALL)
CJK_RE = re.compile(r"[\u3400-\u9fff]")
CACHE_VERSION = 1


class TranslationValidationError(ValueError):
    pass


def parse_args():
    parser = argparse.ArgumentParser(
        description="Translate markdown to bilingual format using an OpenAI-compatible API."
    )
    parser.add_argument("input_md", help="Path to input linearized markdown file")
    parser.add_argument("output_md", nargs="?", help="Optional output bilingual markdown path")
    return parser.parse_args()


def split_into_chunks(markdown_text, max_chunk_length=4000):
    """Split markdown on block boundaries without mixing unrelated block types."""
    del max_chunk_length  # A block is atomic; splitting inside it risks damaging Markdown.
    blocks: list[str] = []
    current: list[str] = []
    fence_marker: str | None = None

    for line in markdown_text.splitlines():
        fence = FENCE_RE.match(line)
        if fence:
            marker = fence.group(1)
            if fence_marker is None:
                fence_marker = marker
            elif marker == fence_marker:
                fence_marker = None

        if not line.strip() and fence_marker is None:
            if current:
                blocks.append("\n".join(current).strip("\n"))
                current = []
            continue
        current.append(line)

    if current:
        blocks.append("\n".join(current).strip("\n"))
    return blocks


def is_translatable_block(block: str) -> bool:
    stripped = block.strip()
    if not stripped:
        return False
    if FENCE_RE.match(stripped):
        return False
    nonempty_lines = [line for line in block.splitlines() if line.strip()]
    if nonempty_lines and all(line.startswith(("    ", "\t")) for line in nonempty_lines):
        return False
    heading_body = re.sub(
        r"^\s*#{1,6}\s+(?:\d+(?:\.\d+)*\.?\s*)?",
        "",
        stripped,
    )
    if re.fullmatch(r"[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+", heading_body):
        return False

    semantic_text = stripped
    for pattern in (IMAGE_RE, INLINE_CODE_RE, INLINE_MATH_RE, LATEX_MATH_RE, URL_RE, HTML_TAG_RE):
        semantic_text = pattern.sub("", semantic_text)
    semantic_text = re.sub(r"[\s#>*_~`|:()\[\]{}-]+", "", semantic_text)
    if re.fullmatch(r"[A-Za-z]", semantic_text):
        return False
    if not any(char.isalpha() for char in semantic_text):
        return False
    if not CJK_RE.search(semantic_text) and not re.search(r"[A-Za-z]{2,}", semantic_text):
        return False
    if len(semantic_text) <= 10 and re.fullmatch(r"[A-Z0-9.+/-]+", semantic_text):
        return False
    return True


def _extract_json_object(content: str) -> dict[str, object]:
    candidate = content.strip()
    if candidate.startswith("```"):
        candidate = re.sub(r"^```(?:json)?\s*", "", candidate, count=1, flags=re.IGNORECASE)
        candidate = re.sub(r"\s*```$", "", candidate, count=1)
    try:
        payload = json.loads(candidate)
        if isinstance(payload, dict):
            return payload
    except json.JSONDecodeError:
        pass

    decoder = json.JSONDecoder()
    for index, char in enumerate(candidate):
        if char != "{":
            continue
        try:
            payload, _ = decoder.raw_decode(candidate[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    raise TranslationValidationError("模型未返回有效 JSON 对象")


def _prefixes(pattern: re.Pattern[str], text: str) -> list[str]:
    return [match.group(1) for line in text.splitlines() if (match := pattern.match(line))]


def _protected_tokens(text: str) -> list[str]:
    tokens: list[str] = []
    for pattern in (
        IMAGE_RE,
        LINK_DESTINATION_RE,
        URL_RE,
        INLINE_CODE_RE,
        HTML_TAG_RE,
        INLINE_MATH_RE,
        LATEX_MATH_RE,
    ):
        tokens.extend(pattern.findall(text))
    return tokens


def validate_translation(source: str, translated: str, block_id: str) -> None:
    translated = translated.strip()
    if not translated:
        raise TranslationValidationError(f"{block_id}: 译文为空")
    if translated.strip() == source.strip() and re.search(r"[A-Za-z]{3,}", source):
        raise TranslationValidationError(f"{block_id}: 模型原样返回了原文")
    if re.search(r"\b(?:original|translated)\s+(?:heading|paragraph|text)\b", translated, re.IGNORECASE):
        raise TranslationValidationError(f"{block_id}: 译文包含模型说明标签")
    if re.search(r"[A-Za-z]{3,}", source) and not CJK_RE.search(translated):
        raise TranslationValidationError(f"{block_id}: 未检测到中文译文")

    if _prefixes(HEADING_RE, source) != _prefixes(HEADING_RE, translated):
        raise TranslationValidationError(f"{block_id}: Markdown 标题层级发生变化")
    if _prefixes(LIST_RE, source) != _prefixes(LIST_RE, translated):
        raise TranslationValidationError(f"{block_id}: Markdown 列表结构发生变化")
    if _prefixes(QUOTE_RE, source) != _prefixes(QUOTE_RE, translated):
        raise TranslationValidationError(f"{block_id}: Markdown 引用结构发生变化")
    if STRONG_MARKER_RE.findall(source) != STRONG_MARKER_RE.findall(translated):
        raise TranslationValidationError(f"{block_id}: Markdown 强调结构发生变化")

    source_table = [line.count("|") for line in source.splitlines() if "|" in line]
    translated_table = [line.count("|") for line in translated.splitlines() if "|" in line]
    if source_table != translated_table:
        raise TranslationValidationError(f"{block_id}: Markdown 表格结构发生变化")

    source_tokens = _protected_tokens(source)
    translated_tokens = _protected_tokens(translated)
    if source_tokens != translated_tokens:
        raise TranslationValidationError(f"{block_id}: 公式、链接或图片引用发生变化")

    source_length = max(1, len(source.strip()))
    ratio = len(translated) / source_length
    if ratio < 0.15 or ratio > 5:
        raise TranslationValidationError(f"{block_id}: 译文长度异常（{ratio:.1f}x）")


def _translation_prompt(chunk: str, block_id: str, validation_feedback: str | None) -> str:
    feedback = f"\n上一次输出未通过校验：{validation_feedback}\n请修正。" if validation_feedback else ""
    request = {BLOCK_ID: block_id, "source_markdown": chunk}
    return f"""
把输入中的学术文本翻译成简体中文。只返回一个 JSON 对象，不要返回代码围栏或解释：
{{"block_id":"原样返回输入 ID","translation":"仅中文译文"}}

要求：
1. translation 只放译文，不重复原文；双语排版由程序完成。
2. 保持标题级别、列表标记、表格分隔符及换行结构。
3. 公式、URL、Markdown 图片引用必须逐字不变。
4. 专业术语准确、表达克制，不补充原文没有的信息。{feedback}

输入：
{json.dumps(request, ensure_ascii=False)}
""".strip()


def _request_completion(
    prompt: str,
    api_key: str,
    base_url: str,
    model: str,
    *,
    system_prompt: str,
) -> str:
    last_error: Exception | None = None
    for attempt in range(1, 5):
        try:
            response = requests.post(
                f"{base_url.rstrip('/')}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0,
                },
                timeout=(20, 120),
            )
            response.raise_for_status()
            result = response.json()
            return str(result["choices"][0]["message"]["content"])
        except requests.RequestException as error:
            last_error = error
            status = error.response.status_code if error.response is not None else None
            retryable = status is None or status == 429 or status >= 500
            if not retryable or attempt == 4:
                raise
            backoff = min(2 ** attempt, 12)
            print(
                f"Warning: 翻译上游暂时不可用(第{attempt}/4次)，{backoff}s 后重试. "
                f"Error: {error}",
                file=sys.stderr,
            )
            time.sleep(backoff)
    raise RuntimeError(f"翻译上游请求失败：{last_error}")


def _split_long_text(text: str, max_length: int = 1200) -> list[str]:
    if len(text) <= max_length:
        return [text]

    units = re.split(r"(?<=[.!?;:。！？；：])(\s+)", text)
    chunks: list[str] = []
    current = ""
    for unit in units:
        if not unit:
            continue
        if current and len(current) + len(unit) > max_length:
            chunks.append(current)
            current = ""
        while len(unit) > max_length:
            boundary = unit.rfind(" ", 0, max_length + 1)
            if boundary <= 0:
                boundary = max_length
            chunks.append(unit[:boundary])
            unit = unit[boundary:]
        current += unit
    if current:
        chunks.append(current)
    return chunks


def _split_preserving_structure(text: str) -> list[tuple[str, bool]]:
    token_patterns = (
        IMAGE_RE,
        FULL_LINK_RE,
        HTML_TAG_RE,
        INLINE_CODE_RE,
        INLINE_MATH_RE,
        LATEX_MATH_RE,
        URL_RE,
        re.compile(r"(?m)^\s{0,3}#{1,6}\s+"),
        re.compile(r"(?m)^\s*(?:[-+*]|\d+[.)])\s+"),
        re.compile(r"(?m)^\s*>+\s*"),
        STRONG_MARKER_RE,
        re.compile(r"\|"),
        re.compile(r"\n"),
    )
    matches = []
    for priority, pattern in enumerate(token_patterns):
        for match in pattern.finditer(text):
            matches.append((match.start(), -len(match.group(0)), priority, match.end()))
    matches.sort()

    pieces: list[tuple[str, bool]] = []
    cursor = 0
    for start, _negative_length, _priority, end in matches:
        if start < cursor:
            continue
        if start > cursor:
            for chunk in _split_long_text(text[cursor:start]):
                pieces.append((chunk, True))
        pieces.append((text[start:end], False))
        cursor = end
    if cursor < len(text):
        for chunk in _split_long_text(text[cursor:]):
            pieces.append((chunk, True))
    return pieces


def _segment_prompt(
    block_id: str,
    segments: list[tuple[str, str]],
    validation_feedback: str | None,
) -> str:
    feedback = f"\n上一次输出未通过校验：{validation_feedback}\n请修正。" if validation_feedback else ""
    request = {
        BLOCK_ID: block_id,
        "segments": [{"id": segment_id, "text": text} for segment_id, text in segments],
    }
    return f"""
把每个 segments.text 中的学术文本翻译成简体中文。只返回一个 JSON 对象：
{{"block_id":"原样返回输入 ID","translations":{{"segment-0001":"对应译文"}}}}

要求：
1. 必须返回所有 segment ID，不能合并、遗漏或增加。
2. translations 的值只放译文，不重复原文，不添加解释。
3. 保留专有名词、数字和原有含义，不补充原文没有的信息。{feedback}

输入：
{json.dumps(request, ensure_ascii=False)}
""".strip()


def _translate_segment_batch(
    segments: list[tuple[str, str]],
    api_key: str,
    base_url: str,
    model: str,
    block_id: str,
    max_retries: int = 4,
) -> dict[str, str]:
    validation_feedback: str | None = None
    last_error: Exception | None = None
    expected_ids = [segment_id for segment_id, _text in segments]

    for attempt in range(1, max_retries + 1):
        content = ""
        try:
            content = _request_completion(
                _segment_prompt(block_id, segments, validation_feedback),
                api_key,
                base_url,
                model,
                system_prompt="你是严谨的学术翻译器。必须返回完整、有效的 JSON。",
            )
            parsed = _extract_json_object(content)
            returned_id = str(parsed.get(BLOCK_ID) or "")
            if returned_id != block_id:
                raise TranslationValidationError(
                    f"块 ID 不匹配：期望 {block_id}，实际 {returned_id or '空'}"
                )
            translations = parsed.get("translations")
            if not isinstance(translations, dict):
                raise TranslationValidationError("translations 必须是 JSON 对象")
            if list(translations) != expected_ids:
                raise TranslationValidationError(
                    f"分段 ID 不完整：期望 {expected_ids}，实际 {list(translations)}"
                )
            result = {key: str(value).strip() for key, value in translations.items()}
            if any(not value for value in result.values()):
                raise TranslationValidationError("分段译文为空")
            return result
        except Exception as error:
            last_error = error
            validation_feedback = str(error)
            if attempt < max_retries:
                time.sleep(min(2 ** (attempt - 1), 4))

    if len(segments) > 1:
        midpoint = len(segments) // 2
        left = _translate_segment_batch(
            segments[:midpoint], api_key, base_url, model, block_id, max_retries
        )
        right = _translate_segment_batch(
            segments[midpoint:], api_key, base_url, model, block_id, max_retries
        )
        return {**left, **right}
    raise TranslationValidationError(f"分段翻译仍失败：{last_error}")


def _translate_preserving_structure(
    source: str,
    api_key: str,
    base_url: str,
    model: str,
    block_id: str,
) -> str:
    pieces = _split_preserving_structure(source)
    segment_sources: list[tuple[str, str]] = []
    segment_slots: dict[int, tuple[str, str, str]] = {}
    for index, (piece, may_translate) in enumerate(pieces):
        if not may_translate:
            continue
        whitespace = re.fullmatch(r"(\s*)(.*?)(\s*)", piece, re.DOTALL)
        assert whitespace is not None
        prefix, core, suffix = whitespace.groups()
        if not is_translatable_block(core):
            continue
        segment_id = f"segment-{len(segment_sources) + 1:04d}"
        segment_sources.append((segment_id, core))
        segment_slots[index] = (segment_id, prefix, suffix)

    if not segment_sources:
        return source

    translated_segments: dict[str, str] = {}
    batch: list[tuple[str, str]] = []
    batch_length = 0
    for segment in segment_sources:
        if batch and (len(batch) >= 24 or batch_length + len(segment[1]) > 3000):
            translated_segments.update(
                _translate_segment_batch(batch, api_key, base_url, model, block_id)
            )
            batch = []
            batch_length = 0
        batch.append(segment)
        batch_length += len(segment[1])
    if batch:
        translated_segments.update(
            _translate_segment_batch(batch, api_key, base_url, model, block_id)
        )

    rebuilt: list[str] = []
    for index, (piece, _may_translate) in enumerate(pieces):
        slot = segment_slots.get(index)
        if not slot:
            rebuilt.append(piece)
            continue
        segment_id, prefix, suffix = slot
        rebuilt.append(prefix + translated_segments[segment_id] + suffix)
    translated = "".join(rebuilt)
    validate_translation(source, translated, block_id)
    return translated


def translate_chunk(chunk, api_key, base_url, model, max_retries=3, block_id="block-0001"):
    """Translate one atomic Markdown block and return bilingual Markdown plus status."""
    if not is_translatable_block(chunk):
        return chunk, True

    last_error: Exception | None = None
    validation_feedback: str | None = None

    for attempt in range(1, max_retries + 1):
        try:
            content = _request_completion(
                _translation_prompt(chunk, block_id, validation_feedback),
                api_key,
                base_url,
                model,
                system_prompt="你是严谨的学术翻译器。必须返回符合要求的 JSON，并严格保持 Markdown 结构。",
            )
            parsed = _extract_json_object(content)
            returned_id = str(parsed.get(BLOCK_ID) or "")
            translated = str(parsed.get(TRANSLATION) or "").strip()
            if returned_id != block_id:
                raise TranslationValidationError(
                    f"块 ID 不匹配：期望 {block_id}，实际 {returned_id or '空'}"
                )
            validate_translation(chunk, translated, block_id)
            return f"{chunk}\n\n{translated}", True
        except Exception as error:
            last_error = error
            validation_feedback = str(error)
            if attempt < max_retries:
                backoff = 2 ** (attempt - 1)
                print(
                    f"Warning: {block_id} 翻译或校验失败(第{attempt}/{max_retries}次), "
                    f"{backoff}s 后重试. Error: {error}",
                    file=sys.stderr,
                )
                time.sleep(backoff)

    try:
        print(f"  {block_id} 启用结构保护分段重试...", file=sys.stderr)
        translated = _translate_preserving_structure(
            chunk, api_key, base_url, model, block_id
        )
        return f"{chunk}\n\n{translated}", True
    except Exception as error:
        last_error = error

    print(
        f"Error: {block_id} 重试 {max_retries} 次仍未通过，保留原文. Error: {last_error}",
        file=sys.stderr,
    )
    return chunk, False


def _translation_cache_path(input_path: Path, output_path: Path | None) -> Path:
    target = output_path or input_path.with_name(input_path.stem + "_bilingual.md")
    return target.with_name(f".{target.name}.translation-cache.json")


def _load_translation_cache(cache_path: Path) -> dict[str, object]:
    try:
        payload = json.loads(cache_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"version": CACHE_VERSION, "entries": {}}
    if payload.get("version") != CACHE_VERSION or not isinstance(payload.get("entries"), dict):
        return {"version": CACHE_VERSION, "entries": {}}
    return payload


def _write_translation_cache(cache_path: Path, payload: dict[str, object]) -> None:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = cache_path.with_name(f".{cache_path.name}.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary.replace(cache_path)


def translate_file(input_path, output_path=None):
    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.deepseek.com/v1")
    model = os.getenv("OPENAI_MODEL", "deepseek-chat").strip()

    if not api_key:
        raise ValueError("OPENAI_API_KEY environment variable is not set.")
    if not model:
        raise ValueError("OPENAI_MODEL environment variable is not set.")

    markdown_text = input_path.read_text(encoding="utf-8")
    blocks = split_into_chunks(markdown_text)
    translated_blocks: list[str] = []
    failed_indices: list[int] = []
    cache_path = _translation_cache_path(input_path, output_path)
    cache = _load_translation_cache(cache_path)
    cache_entries = cache["entries"]
    assert isinstance(cache_entries, dict)
    translatable_count = sum(1 for block in blocks if is_translatable_block(block))
    print(f"Translating {input_path.name} ({translatable_count} text blocks)...")

    text_index = 0
    for block in blocks:
        if not is_translatable_block(block):
            translated_blocks.append(block)
            continue
        text_index += 1
        block_id = f"block-{text_index:04d}"
        print(f"  Translating {block_id} ({text_index}/{translatable_count})...")
        source_hash = hashlib.sha256(block.encode("utf-8")).hexdigest()
        cached_key: str | None = None
        cached = cache_entries.get(block_id)
        if isinstance(cached, dict) and cached.get("sourceSha256") == source_hash:
            cached_key = block_id
        else:
            cached_match = next(
                (
                    (key, entry)
                    for key, entry in cache_entries.items()
                    if isinstance(entry, dict)
                    and entry.get("sourceSha256") == source_hash
                ),
                None,
            )
            if cached_match:
                cached_key, cached = cached_match
        translated_block = block
        ok = False
        if isinstance(cached, dict) and cached.get("sourceSha256") == source_hash:
            cached_translation = str(cached.get("translation") or "")
            try:
                validate_translation(block, cached_translation, block_id)
                translated_block = f"{block}\n\n{cached_translation}"
                ok = True
                print(f"    Reusing validated checkpoint for {block_id}.")
            except TranslationValidationError:
                if cached_key:
                    cache_entries.pop(cached_key, None)
        if not ok:
            translated_block, ok = translate_chunk(
                block,
                api_key,
                base_url,
                model,
                block_id=block_id,
            )
        translated_blocks.append(translated_block)
        if ok:
            translated_prefix = f"{block}\n\n"
            if translated_block.startswith(translated_prefix):
                cache_entries[source_hash] = {
                    "sourceSha256": source_hash,
                    "translation": translated_block[len(translated_prefix):],
                }
                _write_translation_cache(cache_path, cache)
        else:
            failed_indices.append(text_index)

    if failed_indices:
        ratio = len(failed_indices) / max(1, translatable_count)
        msg = (
            f"翻译完成，但有 {len(failed_indices)}/{translatable_count} 个文本块未通过校验"
            f"（已保留原文）: {failed_indices}"
        )
        print(f"WARNING: {msg}", file=sys.stderr)
        raise RuntimeError(
            f"翻译有 {ratio:.0%} 的文本块未通过校验，未发布双语文件。{msg}。"
        )

    bilingual_markdown = "\n\n".join(translated_blocks)
    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_output = output_path.with_name(f".{output_path.name}.tmp")
        temporary_output.write_text(bilingual_markdown, encoding="utf-8")
        temporary_output.replace(output_path)

    print(f"翻译全部通过结构校验（{translatable_count} blocks）。")

    return bilingual_markdown


def main():
    args = parse_args()
    input_path = Path(args.input_md).resolve()
    if not input_path.exists():
        print(f"Error: File not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    output_path = (
        Path(args.output_md).resolve()
        if args.output_md
        else input_path.with_name(input_path.stem + "_bilingual.md")
    )
    try:
        translate_file(input_path, output_path)
        print(f"Translation complete. Output saved to: {output_path}")
    except Exception as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
