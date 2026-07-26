from __future__ import annotations

from http import HTTPStatus
from typing import Any, Callable
from urllib.parse import parse_qs, unquote


def handle_get(
    handler: Any,
    parsed: Any,
    *,
    load_settings: Callable[[], dict[str, object]],
    detect_capabilities: Callable[[], dict[str, object]],
    list_tasks: Callable[[], list[dict[str, object]]],
    build_agent_memory_payload: Callable[[str], dict[str, object]],
    zotero_status: Callable[[], dict[str, object]],
    list_zotero_papers: Callable[[str], list[dict[str, object]]],
    list_papers: Callable[[], list[dict[str, object]]],
    search_records: Callable[[str, int], list[dict[str, object]]],
    list_memory_candidates: Callable[[], dict[str, object]],
    list_memory_research_state: Callable[[], dict[str, object]] | None = None,
) -> bool:
    if parsed.path == "/api/settings":
        handler.write_json(load_settings())
        return True

    if parsed.path == "/api/capabilities":
        handler.write_json(detect_capabilities())
        return True

    if parsed.path == "/api/tasks":
        handler.write_json(list_tasks())
        return True

    if parsed.path == "/api/agent-memory":
        query = parse_qs(parsed.query).get("q", [""])[0]
        handler.write_json(build_agent_memory_payload(query))
        return True

    if parsed.path == "/api/memory/candidates":
        handler.write_json(list_memory_candidates())
        return True

    if parsed.path == "/api/memory/research-state":
        if list_memory_research_state is None:
            handler.write_json({"error": "memory research state API is unavailable"}, status=HTTPStatus.NOT_FOUND)
            return True
        handler.write_json(list_memory_research_state())
        return True

    if parsed.path == "/api/zotero/status":
        handler.write_json(zotero_status())
        return True

    if parsed.path == "/api/zotero/items":
        query = parse_qs(parsed.query).get("q", [""])[0]
        try:
            handler.write_json(list_zotero_papers(query))
        except Exception as error:
            status = _classify_zotero_list_error(error)
            handler.write_json({"error": str(error)}, status=status)
        return True

    if parsed.path == "/api/papers":
        handler.write_json(list_papers())
        return True

    if parsed.path == "/api/search":
        query = parse_qs(parsed.query).get("q", [""])[0]
        limit_value = parse_qs(parsed.query).get("limit", ["80"])[0]
        try:
            limit = int(limit_value)
        except (TypeError, ValueError):
            limit = 80
        handler.write_json(search_records(query, limit))
        return True

    return False


def handle_post(
    handler: Any,
    parsed: Any,
    *,
    read_json_body: Callable[[], dict[str, object]],
    read_binary_body: Callable[[], bytes],
    save_settings: Callable[[dict[str, object]], dict[str, object]],
    create_agent_memory_item: Callable[[dict[str, object]], dict[str, object]],
    run_connection_test: Callable[..., dict[str, object]],
    ensure_upload_ready: Callable[[], None],
    create_upload_task: Callable[[str, bytes], dict[str, object]],
    import_zotero_paper: Callable[[str], dict[str, object]],
    retry_upload_task: Callable[[str], dict[str, object]],
    activate_memory_candidate: Callable[[str], dict[str, object]],
    archive_memory_candidate: Callable[[str], dict[str, object]],
    get_record: Callable[[str], Any],
    resolve_open_target: Callable[[Any, str], Any],
    open_in_explorer: Callable[[Any], None],
    runtime_output_dir: Any,
    import_paper_package: Callable[[bytes], dict[str, object]] | None = None,
) -> bool:
    if parsed.path == "/api/settings":
        handler.write_json(save_settings(read_json_body()))
        return True

    if parsed.path == "/api/agent-memory":
        payload = read_json_body()
        try:
            item = create_agent_memory_item(payload)
            handler.write_json(item, status=HTTPStatus.CREATED)
        except ValueError as error:
            handler.write_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
        return True

    if parsed.path.startswith("/api/memory/candidates/") and parsed.path.endswith("/activate"):
        item_id = unquote(parsed.path.removeprefix("/api/memory/candidates/").removesuffix("/activate").strip("/"))
        try:
            handler.write_json(activate_memory_candidate(item_id))
        except FileNotFoundError as error:
            handler.write_json({"error": str(error)}, status=HTTPStatus.NOT_FOUND)
        except ValueError as error:
            handler.write_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
        return True

    if parsed.path.startswith("/api/memory/candidates/") and parsed.path.endswith("/archive"):
        item_id = unquote(parsed.path.removeprefix("/api/memory/candidates/").removesuffix("/archive").strip("/"))
        try:
            handler.write_json(archive_memory_candidate(item_id))
        except FileNotFoundError as error:
            handler.write_json({"error": str(error)}, status=HTTPStatus.NOT_FOUND)
        except ValueError as error:
            handler.write_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
        return True

    if parsed.path == "/api/settings/test":
        payload = read_json_body()
        target = payload.get("target")
        agent_id = payload.get("agentId")
        settings_payload = payload.get("settings")
        if not isinstance(target, str) or not isinstance(settings_payload, dict):
            handler.write_json({"error": "参数错误"}, status=HTTPStatus.BAD_REQUEST)
            return True
        result = run_connection_test(target, settings_payload, agent_id if isinstance(agent_id, str) else None)
        status = HTTPStatus.OK if result.get("ok") else HTTPStatus.BAD_REQUEST
        handler.write_json(result, status=status)
        return True

    if parsed.path == "/api/tasks/upload":
        file_name = handler.headers.get("X-File-Name")
        if not isinstance(file_name, str) or not file_name.strip():
            handler.write_json({"error": "缺少文件名"}, status=HTTPStatus.BAD_REQUEST)
            return True
        try:
            ensure_upload_ready()
            task = create_upload_task(file_name, read_binary_body())
            handler.write_json(task, status=HTTPStatus.CREATED)
        except ValueError as error:
            handler.write_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
        return True

    if parsed.path == "/api/library/import-paper":
        if import_paper_package is None:
            handler.write_json({"error": "文献包导入功能不可用"}, status=HTTPStatus.NOT_FOUND)
            return True
        try:
            paper = import_paper_package(read_binary_body())
            handler.write_json(paper, status=HTTPStatus.CREATED)
        except ValueError as error:
            handler.write_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
        return True

    if parsed.path == "/api/zotero/import":
        payload = read_json_body()
        attachment_key = payload.get("attachmentKey")
        if not isinstance(attachment_key, str):
            handler.write_json({"error": "缺少 Zotero 附件标识"}, status=HTTPStatus.BAD_REQUEST)
            return True
        try:
            ensure_upload_ready()
            task = import_zotero_paper(attachment_key)
            handler.write_json(task, status=HTTPStatus.CREATED)
        except Exception as error:
            status = _classify_zotero_import_error(error)
            handler.write_json({"error": str(error)}, status=status)
        return True

    if parsed.path.startswith("/api/tasks/") and parsed.path.endswith("/retry"):
        task_id = unquote(parsed.path.removeprefix("/api/tasks/").removesuffix("/retry").strip("/"))
        try:
            handler.write_json(retry_upload_task(task_id))
        except ValueError as error:
            handler.write_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
        except FileNotFoundError as error:
            handler.write_json({"error": str(error)}, status=HTTPStatus.NOT_FOUND)
        return True

    if parsed.path == "/api/actions/open":
        payload = read_json_body()
        paper_id = payload.get("paperId")
        target = payload.get("target")
        if not isinstance(paper_id, str) or not isinstance(target, str):
            handler.write_json({"error": "参数错误"}, status=HTTPStatus.BAD_REQUEST)
            return True
        try:
            record = get_record(paper_id)
            open_in_explorer(resolve_open_target(record, target))
            handler.write_json({"ok": True})
        except FileNotFoundError as error:
            handler.write_json({"error": str(error)}, status=HTTPStatus.NOT_FOUND)
        return True

    if parsed.path == "/api/actions/open-runtime":
        runtime_output_dir.mkdir(parents=True, exist_ok=True)
        open_in_explorer(runtime_output_dir)
        handler.write_json({"ok": True})
        return True

    return False


def handle_patch(
    handler: Any,
    parsed: Any,
    *,
    read_json_body: Callable[[], dict[str, object]],
    update_agent_memory_item: Callable[[str, dict[str, object]], dict[str, object]],
) -> bool:
    if not parsed.path.startswith("/api/agent-memory/"):
        return False
    item_id = unquote(parsed.path.removeprefix("/api/agent-memory/").strip("/"))
    payload = read_json_body()
    try:
        handler.write_json(update_agent_memory_item(item_id, payload))
    except ValueError as error:
        handler.write_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
    except FileNotFoundError as error:
        handler.write_json({"error": str(error)}, status=HTTPStatus.NOT_FOUND)
    return True


def handle_delete(
    handler: Any,
    parsed: Any,
    *,
    delete_agent_memory_item: Callable[[str], None],
    build_agent_memory_payload: Callable[[str], dict[str, object]],
) -> bool:
    if not parsed.path.startswith("/api/agent-memory/"):
        return False
    item_id = unquote(parsed.path.removeprefix("/api/agent-memory/").strip("/"))
    try:
        delete_agent_memory_item(item_id)
        handler.write_json(build_agent_memory_payload(""))
    except ValueError as error:
        handler.write_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
    except FileNotFoundError as error:
        handler.write_json({"error": str(error)}, status=HTTPStatus.NOT_FOUND)
    return True


def _classify_zotero_list_error(error: Exception) -> HTTPStatus:
    error_name = type(error).__name__
    if error_name in {"ZoteroUnavailableError", "ZoteroApiDisabledError"}:
        return HTTPStatus.SERVICE_UNAVAILABLE
    return HTTPStatus.BAD_GATEWAY


def _classify_zotero_import_error(error: Exception) -> HTTPStatus:
    error_name = type(error).__name__
    if isinstance(error, ValueError) or error_name == "ZoteroApiDisabledError":
        return HTTPStatus.BAD_REQUEST
    if error_name == "ZoteroUnavailableError":
        return HTTPStatus.SERVICE_UNAVAILABLE
    if isinstance(error, FileNotFoundError):
        return HTTPStatus.NOT_FOUND
    return HTTPStatus.BAD_GATEWAY
