from __future__ import annotations

from typing import Any, Callable

import gui_agent_memory
import gui_copilot_runs
import gui_exports
import gui_library
import gui_memory
import gui_memory_candidates
import gui_memory_research


class ServerBindings:
    def __init__(
        self,
        *,
        memory_root_getter: Callable[[], Any],
        runtime_output_dir_getter: Callable[[], Any],
        store_getter: Callable[[], Any],
        current_timestamp_iso_getter: Callable[[], Callable[[], str]],
        load_settings_getter: Callable[[], Callable[[], dict[str, object]]],
        detect_capabilities_getter: Callable[[], Callable[[], dict[str, object]]],
        list_tasks_getter: Callable[[], Callable[[], list[dict[str, object]]]],
        zotero_status_getter: Callable[[], Callable[[], dict[str, object]]],
        list_zotero_papers_getter: Callable[[], Callable[[str], list[dict[str, object]]]],
        list_papers_getter: Callable[[], Callable[[], list[dict[str, object]]]],
        search_records_getter: Callable[[], Callable[[str, int], list[dict[str, object]]]],
        save_settings_getter: Callable[[], Callable[[dict[str, object]], dict[str, object]]],
        run_connection_test_getter: Callable[[], Callable[..., dict[str, object]]],
        ensure_upload_ready_getter: Callable[[], Callable[[], None]],
        create_upload_task_getter: Callable[[], Callable[[str, bytes], dict[str, object]]],
        import_zotero_paper_getter: Callable[[], Callable[[str], dict[str, object]]],
        retry_upload_task_getter: Callable[[], Callable[[str], dict[str, object]]],
        import_paper_package_getter: Callable[[], Callable[[bytes], dict[str, object]]],
        get_record_getter: Callable[[], Callable[[str], Any]],
        resolve_open_target_getter: Callable[[], Callable[[Any, str], Any]],
        open_in_explorer_getter: Callable[[], Callable[[Any], None]],
        build_detail_getter: Callable[[], Callable[[Any], dict[str, object]]],
        load_annotations_getter: Callable[[], Callable[[Any], list[dict[str, object]]]],
        build_default_reading_state_getter: Callable[[], Callable[[Any], dict[str, object]]],
        list_copilot_runs_getter: Callable[[], Callable[[Any, str | None], list[dict[str, object]]]],
        resolve_media_path_getter: Callable[[], Callable[[Any, str], Any]],
        create_annotation_getter: Callable[[], Callable[[Any, dict[str, object]], Any]],
        invoke_annotation_agent_getter: Callable[[], Callable[[Any, dict[str, object]], Any]],
        create_copilot_run_getter: Callable[[], Callable[[Any, dict[str, object]], dict[str, object]]],
        retry_copilot_run_getter: Callable[[], Callable[[Any, str, str | None], dict[str, object]]],
        load_annotation_getter: Callable[[], Callable[[Any, str], tuple[Any, dict[str, object]]]],
        append_annotation_comment_getter: Callable[[], Callable[[Any, str, dict[str, object]], Any]],
        refresh_index_getter: Callable[[], Callable[[Any], None]],
        build_paper_summary_getter: Callable[[], Callable[[Any], dict[str, object]]],
        update_annotation_comment_getter: Callable[[], Callable[[Any, str, str, dict[str, object]], Any]],
        update_annotation_getter: Callable[[], Callable[[Any, str, dict[str, object]], Any]],
        delete_annotation_getter: Callable[[], Callable[[Any, str], Any]],
    ) -> None:
        self._memory_root_getter = memory_root_getter
        self._runtime_output_dir_getter = runtime_output_dir_getter
        self._store_getter = store_getter
        self._current_timestamp_iso_getter = current_timestamp_iso_getter
        self._load_settings_getter = load_settings_getter
        self._detect_capabilities_getter = detect_capabilities_getter
        self._list_tasks_getter = list_tasks_getter
        self._zotero_status_getter = zotero_status_getter
        self._list_zotero_papers_getter = list_zotero_papers_getter
        self._list_papers_getter = list_papers_getter
        self._search_records_getter = search_records_getter
        self._save_settings_getter = save_settings_getter
        self._run_connection_test_getter = run_connection_test_getter
        self._ensure_upload_ready_getter = ensure_upload_ready_getter
        self._create_upload_task_getter = create_upload_task_getter
        self._import_zotero_paper_getter = import_zotero_paper_getter
        self._retry_upload_task_getter = retry_upload_task_getter
        self._import_paper_package_getter = import_paper_package_getter
        self._get_record_getter = get_record_getter
        self._resolve_open_target_getter = resolve_open_target_getter
        self._open_in_explorer_getter = open_in_explorer_getter
        self._build_detail_getter = build_detail_getter
        self._load_annotations_getter = load_annotations_getter
        self._build_default_reading_state_getter = build_default_reading_state_getter
        self._list_copilot_runs_getter = list_copilot_runs_getter
        self._resolve_media_path_getter = resolve_media_path_getter
        self._create_annotation_getter = create_annotation_getter
        self._invoke_annotation_agent_getter = invoke_annotation_agent_getter
        self._create_copilot_run_getter = create_copilot_run_getter
        self._retry_copilot_run_getter = retry_copilot_run_getter
        self._load_annotation_getter = load_annotation_getter
        self._append_annotation_comment_getter = append_annotation_comment_getter
        self._refresh_index_getter = refresh_index_getter
        self._build_paper_summary_getter = build_paper_summary_getter
        self._update_annotation_comment_getter = update_annotation_comment_getter
        self._update_annotation_getter = update_annotation_getter
        self._delete_annotation_getter = delete_annotation_getter

    def app_get(self) -> dict[str, object]:
        return build_app_get_bindings(
            memory_root=self._memory_root_getter(),
            load_settings=self._load_settings_getter(),
            detect_capabilities=self._detect_capabilities_getter(),
            list_tasks=self._list_tasks_getter(),
            zotero_status=self._zotero_status_getter(),
            list_zotero_papers=self._list_zotero_papers_getter(),
            list_papers=self._list_papers_getter(),
            search_records=self._search_records_getter(),
            get_record=self._get_record_getter(),
        )

    def app_post(self) -> dict[str, object]:
        return build_app_post_bindings(
            memory_root=self._memory_root_getter(),
            runtime_output_dir=self._runtime_output_dir_getter(),
            save_settings=self._save_settings_getter(),
            run_connection_test=self._run_connection_test_getter(),
            ensure_upload_ready=self._ensure_upload_ready_getter(),
            create_upload_task=self._create_upload_task_getter(),
            import_zotero_paper=self._import_zotero_paper_getter(),
            retry_upload_task=self._retry_upload_task_getter(),
            import_paper_package=self._import_paper_package_getter(),
            get_record=self._get_record_getter(),
            list_papers=self._list_papers_getter(),
            resolve_open_target=self._resolve_open_target_getter(),
            open_in_explorer=self._open_in_explorer_getter(),
        )

    def app_patch(self) -> dict[str, object]:
        return build_app_patch_bindings(
            memory_root=self._memory_root_getter(),
        )

    def app_delete(self) -> dict[str, object]:
        return build_app_delete_bindings(
            memory_root=self._memory_root_getter(),
        )

    def papers_get(self) -> dict[str, object]:
        return build_papers_get_bindings(
            store=self._store_getter(),
            memory_root=self._memory_root_getter(),
            get_record=self._get_record_getter(),
            build_detail=self._build_detail_getter(),
            load_annotations=self._load_annotations_getter(),
            build_default_reading_state=self._build_default_reading_state_getter(),
            list_copilot_runs=self._list_copilot_runs_getter(),
            resolve_media_path=self._resolve_media_path_getter(),
        )

    def papers_post(self) -> dict[str, object]:
        return build_papers_post_bindings(
            memory_root=self._memory_root_getter(),
            get_record=self._get_record_getter(),
            create_annotation=self._create_annotation_getter(),
            invoke_annotation_agent=self._invoke_annotation_agent_getter(),
            create_copilot_run=self._create_copilot_run_getter(),
            retry_copilot_run=self._retry_copilot_run_getter(),
            load_annotation=self._load_annotation_getter(),
            append_annotation_comment=self._append_annotation_comment_getter(),
            load_annotations=self._load_annotations_getter(),
            refresh_index=self._refresh_index_getter(),
        )

    def papers_put(self) -> dict[str, object]:
        return build_papers_put_bindings(
            store=self._store_getter(),
            current_timestamp_iso=self._current_timestamp_iso_getter(),
            get_record=self._get_record_getter(),
        )

    def papers_patch(self) -> dict[str, object]:
        return build_papers_patch_bindings(
            memory_root=self._memory_root_getter(),
            get_record=self._get_record_getter(),
            build_paper_summary=self._build_paper_summary_getter(),
            update_annotation_comment=self._update_annotation_comment_getter(),
            update_annotation=self._update_annotation_getter(),
            load_annotations=self._load_annotations_getter(),
            refresh_index=self._refresh_index_getter(),
        )

    def papers_delete(self) -> dict[str, object]:
        return build_papers_delete_bindings(
            memory_root=self._memory_root_getter(),
            get_record=self._get_record_getter(),
            delete_annotation=self._delete_annotation_getter(),
            load_annotations=self._load_annotations_getter(),
            refresh_index=self._refresh_index_getter(),
        )


def build_app_get_bindings(
    *,
    memory_root,
    load_settings: Callable[[], dict[str, object]],
    detect_capabilities: Callable[[], dict[str, object]],
    list_tasks: Callable[[], list[dict[str, object]]],
    zotero_status: Callable[[], dict[str, object]],
    list_zotero_papers: Callable[[str], list[dict[str, object]]],
    list_papers: Callable[[], list[dict[str, object]]],
    search_records: Callable[[str, int], list[dict[str, object]]],
    get_record: Callable[[str], Any],
) -> dict[str, object]:
    return {
        "load_settings": load_settings,
        "detect_capabilities": detect_capabilities,
        "list_tasks": list_tasks,
        "build_agent_memory_payload": lambda query: gui_agent_memory.build_agent_memory_payload(memory_root, query=query),
        "zotero_status": zotero_status,
        "list_zotero_papers": list_zotero_papers,
        "list_papers": list_papers,
        "search_records": search_records,
        "list_memory_candidates": lambda: gui_memory_candidates.list_memory_candidates(
            memory_root,
            list_candidate_records(list_papers, get_record),
        ),
        "list_memory_research_state": lambda: gui_memory_research.list_memory_research_state(
            memory_root,
            list_candidate_records(list_papers, get_record),
        ),
    }


def build_app_post_bindings(
    *,
    memory_root,
    runtime_output_dir,
    save_settings: Callable[[dict[str, object]], dict[str, object]],
    run_connection_test: Callable[..., dict[str, object]],
    ensure_upload_ready: Callable[[], None],
    create_upload_task: Callable[[str, bytes], dict[str, object]],
    import_zotero_paper: Callable[[str], dict[str, object]],
    retry_upload_task: Callable[[str], dict[str, object]],
    import_paper_package: Callable[[bytes], dict[str, object]],
    get_record: Callable[[str], Any],
    list_papers: Callable[[], list[dict[str, object]]],
    resolve_open_target: Callable[[Any, str], Any],
    open_in_explorer: Callable[[Any], None],
) -> dict[str, object]:
    return {
        "save_settings": save_settings,
        "create_agent_memory_item": lambda payload: gui_agent_memory.create_agent_memory_item(memory_root, payload),
        "run_connection_test": run_connection_test,
        "ensure_upload_ready": ensure_upload_ready,
        "create_upload_task": create_upload_task,
        "import_zotero_paper": import_zotero_paper,
        "retry_upload_task": retry_upload_task,
        "import_paper_package": import_paper_package,
        "activate_memory_candidate": lambda item_id: gui_memory_candidates.activate_memory_candidate(
            memory_root,
            item_id,
            list_candidate_records(list_papers, get_record),
        ),
        "archive_memory_candidate": lambda item_id: gui_memory_candidates.archive_memory_candidate(
            memory_root,
            item_id,
            list_candidate_records(list_papers, get_record),
        ),
        "get_record": get_record,
        "resolve_open_target": resolve_open_target,
        "open_in_explorer": open_in_explorer,
        "runtime_output_dir": runtime_output_dir,
    }


def build_app_patch_bindings(
    *,
    memory_root,
) -> dict[str, object]:
    return {
        "update_agent_memory_item": lambda item_id, payload: gui_agent_memory.update_agent_memory_item(
            memory_root,
            item_id,
            payload,
        ),
    }


def list_candidate_records(
    list_papers: Callable[[], list[dict[str, object]]],
    get_record: Callable[[str], Any],
) -> list[Any]:
    records: list[Any] = []
    for paper in list_papers():
        paper_id = paper.get("id") if isinstance(paper, dict) else None
        if not isinstance(paper_id, str) or not paper_id:
            continue
        try:
            records.append(get_record(paper_id))
        except FileNotFoundError:
            continue
    return records


def build_app_delete_bindings(
    *,
    memory_root,
) -> dict[str, object]:
    return {
        "delete_agent_memory_item": lambda item_id: gui_agent_memory.delete_agent_memory_item(memory_root, item_id),
        "build_agent_memory_payload": lambda query: gui_agent_memory.build_agent_memory_payload(memory_root, query=query),
    }


def build_papers_get_bindings(
    *,
    store,
    memory_root,
    get_record: Callable[[str], Any],
    build_detail: Callable[[Any], dict[str, object]],
    load_annotations: Callable[[Any], list[dict[str, object]]],
    build_default_reading_state: Callable[[Any], dict[str, object]],
    list_copilot_runs: Callable[[Any, str | None], list[dict[str, object]]],
    resolve_media_path: Callable[[Any, str], Any],
) -> dict[str, object]:
    return {
        "get_record": get_record,
        "build_detail": build_detail,
        "load_annotations": load_annotations,
        "get_reading_state": store.get_reading_state,
        "build_default_reading_state": build_default_reading_state,
        "build_memory_payload": lambda record: gui_memory.build_memory_payload(record, memory_root),
        "list_copilot_runs": list_copilot_runs,
        "resolve_media_path": resolve_media_path,
    }


def build_papers_post_bindings(
    *,
    memory_root,
    get_record: Callable[[str], Any],
    create_annotation: Callable[[Any, dict[str, object]], Any],
    invoke_annotation_agent: Callable[[Any, dict[str, object]], Any],
    create_copilot_run: Callable[[Any, dict[str, object]], dict[str, object]],
    retry_copilot_run: Callable[[Any, str, str | None], dict[str, object]],
    load_annotation: Callable[[Any, str], tuple[Any, dict[str, object]]],
    append_annotation_comment: Callable[[Any, str, dict[str, object]], Any],
    load_annotations: Callable[[Any], list[dict[str, object]]],
    refresh_index: Callable[[Any], None],
) -> dict[str, object]:
    return {
        "get_record": get_record,
        "create_annotation": create_annotation,
        "invoke_annotation_agent": invoke_annotation_agent,
        "create_copilot_run": create_copilot_run,
        "cancel_copilot_run": lambda record, run_id: gui_copilot_runs.cancel_run(record, memory_root, run_id),
        "retry_copilot_run": retry_copilot_run,
        "export_markdown": lambda record: gui_exports.export_paper_memory_markdown(record, memory_root),
        "load_annotation": load_annotation,
        "create_memory_from_annotation": lambda record, annotation, payload: gui_memory.create_memory_item_from_annotation(
            record,
            memory_root,
            annotation,
            payload,
        ),
        "create_memory_candidates_from_agent_comment": lambda record, annotation, payload: gui_memory.create_memory_candidates_from_agent_comment(
            record,
            memory_root,
            annotation,
            payload,
        ),
        "append_annotation_comment": append_annotation_comment,
        "create_memory_item": lambda record, payload: gui_memory.create_memory_item(record, memory_root, payload),
        "create_memory_note": lambda record, payload: gui_memory.create_memory_note(record, memory_root, payload),
        "load_annotations": load_annotations,
        "build_memory_payload": lambda record: gui_memory.build_memory_payload(record, memory_root),
        "refresh_index": refresh_index,
    }


def build_papers_put_bindings(
    *,
    store,
    current_timestamp_iso: Callable[[], str],
    get_record: Callable[[str], Any],
) -> dict[str, object]:
    return {
        "get_record": get_record,
        "save_reading_state": lambda record, payload: store.save_reading_state(
            record.paper_id,
            payload,
            current_timestamp_iso(),
        ),
    }


def build_papers_patch_bindings(
    *,
    memory_root,
    get_record: Callable[[str], Any],
    build_paper_summary: Callable[[Any], dict[str, object]],
    update_annotation_comment: Callable[[Any, str, str, dict[str, object]], Any],
    update_annotation: Callable[[Any, str, dict[str, object]], Any],
    load_annotations: Callable[[Any], list[dict[str, object]]],
    refresh_index: Callable[[Any], None],
) -> dict[str, object]:
    return {
        "get_record": get_record,
        "update_library": lambda record, payload: gui_library.update_library_meta(record, memory_root, payload),
        "build_paper_summary": build_paper_summary,
        "update_memory_item": lambda record, item_id, payload: gui_memory.update_memory_item(
            record,
            memory_root,
            item_id,
            payload,
        ),
        "update_annotation_comment": update_annotation_comment,
        "update_annotation": update_annotation,
        "build_memory_payload": lambda record: gui_memory.build_memory_payload(record, memory_root),
        "load_annotations": load_annotations,
        "refresh_index": refresh_index,
    }


def build_papers_delete_bindings(
    *,
    memory_root,
    get_record: Callable[[str], Any],
    delete_annotation: Callable[[Any, str], Any],
    load_annotations: Callable[[Any], list[dict[str, object]]],
    refresh_index: Callable[[Any], None],
) -> dict[str, object]:
    return {
        "get_record": get_record,
        "delete_memory_item": lambda record, item_id: gui_memory.delete_memory_item(record, memory_root, item_id),
        "delete_annotation": delete_annotation,
        "build_memory_payload": lambda record: gui_memory.build_memory_payload(record, memory_root),
        "load_annotations": load_annotations,
        "refresh_index": refresh_index,
    }
