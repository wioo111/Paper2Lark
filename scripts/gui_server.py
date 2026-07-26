import os
import re
import sys
import threading
import uuid
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import gui_annotations
import gui_app_settings
import gui_app_utils
import gui_http
import gui_library_packages
import gui_copilot
import gui_papers
import gui_server_bindings
import gui_server_common
import gui_server_dispatch
import gui_server_facades
import gui_server_records
import gui_server_runtime
import gui_server_uploads
import gui_upload_tasks
import gui_zotero
from gui_storage import SingleInstanceLock, WorkbenchStore, format_task_command
from process_utils import is_process_alive


WORKBENCH_ROOT = Path(__file__).resolve().parents[1]
GUI_DIST_DIR = WORKBENCH_ROOT / "gui" / "dist"
CONFIG_DIR = WORKBENCH_ROOT / "config"


def resolve_runtime_root(
    argv: list[str] | None = None,
    environ: dict[str, str] | None = None,
) -> Path:
    environ = environ if environ is not None else os.environ
    argv = argv if argv is not None else sys.argv[1:]
    runtime_value = str(environ.get("CARK_RUNTIME_ROOT") or "").strip()
    if not runtime_value:
        for index, item in enumerate(argv):
            if item == "--runtime-root" and index + 1 < len(argv):
                runtime_value = argv[index + 1]
                break
            if item.startswith("--runtime-root="):
                runtime_value = item.split("=", 1)[1]
                break
    if runtime_value:
        return Path(runtime_value).expanduser().resolve()
    return WORKBENCH_ROOT / "runtime"


RUNTIME_ROOT_DIR = resolve_runtime_root()
RUNTIME_OUTPUT_DIR = RUNTIME_ROOT_DIR / "output"
MEMORY_ROOT_DIR = RUNTIME_ROOT_DIR / "memory"
DATABASE_PATH = RUNTIME_ROOT_DIR / "cark.sqlite3"
INSTANCE_LOCK_PATH = RUNTIME_ROOT_DIR / "locks" / "gui_server.lock"
GUI_SETTINGS_PATH = CONFIG_DIR / "gui_settings.json"
GUI_UPLOADS_DIR = RUNTIME_ROOT_DIR / "uploads" / "gui"
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
UUID_DIR_RE = re.compile(r"^(?:[0-9a-fA-F-]{32,36}|task-\d{14}-[0-9a-fA-F]{6})$")
PROXY_ENV_KEYS = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
)
STORE = WorkbenchStore(DATABASE_PATH)
SERVER_INSTANCE_ID = f"{os.getpid()}-{uuid.uuid4().hex}"
ZOTERO_IMPORT_LOCK = threading.Lock()
COPILOT_RUN_TIMEOUT_SECONDS = 180
MOBILE_APP_ORIGINS = {"https://localhost", "capacitor://localhost"}


def is_mobile_app_origin(origin: str | None) -> bool:
    return bool(origin and origin.strip().lower() in MOBILE_APP_ORIGINS)


PaperRecord = gui_server_common.PaperRecord
default_copilot_agent = gui_server_common.default_copilot_agent
current_timestamp_iso = gui_server_common.current_timestamp_iso
encode_paper_id = gui_server_common.encode_paper_id
decode_paper_id = gui_server_common.decode_paper_id


default_gui_settings = partial(
    gui_app_settings.default_gui_settings,
    config_dir=CONFIG_DIR,
    load_first_json_object=gui_app_utils.load_first_json_object,
    default_copilot_agent=default_copilot_agent,
)

sanitize_gui_settings = partial(
    gui_app_settings.sanitize_gui_settings,
    default_settings_factory=default_gui_settings,
    default_copilot_agent=default_copilot_agent,
)

materialize_gui_settings = partial(
    gui_app_settings.materialize_gui_settings,
    settings_path=GUI_SETTINGS_PATH,
    default_settings_factory=default_gui_settings,
    sanitize_settings=sanitize_gui_settings,
    load_json_object=gui_app_utils.load_json_object,
    write_json_file=gui_app_utils.write_json_file,
)

load_gui_settings = partial(
    gui_app_settings.load_gui_settings,
    settings_path=GUI_SETTINGS_PATH,
    materialize_settings=materialize_gui_settings,
    sanitize_settings=sanitize_gui_settings,
    load_json_object=gui_app_utils.load_json_object,
)

save_gui_settings = partial(
    gui_app_settings.save_gui_settings,
    settings_path=GUI_SETTINGS_PATH,
    sanitize_settings=sanitize_gui_settings,
    write_json_file=gui_app_utils.write_json_file,
)

detect_capabilities = partial(
    gui_app_settings.detect_capabilities,
    workbench_root=WORKBENCH_ROOT,
    load_settings=load_gui_settings,
)


test_mineru_connection = gui_app_settings.test_mineru_connection
test_translation_connection = gui_app_settings.test_translation_connection
test_copilot_agent_connection = gui_app_settings.test_copilot_agent_connection

run_connection_test = partial(
    gui_app_settings.run_connection_test,
    sanitize_settings=sanitize_gui_settings,
    test_mineru_connection_func=test_mineru_connection,
    test_translation_connection_func=test_translation_connection,
    test_copilot_agent_connection_func=test_copilot_agent_connection,
)

snapshot_task = partial(gui_upload_tasks.snapshot_task, STORE)
list_tasks_payload = partial(gui_upload_tasks.list_tasks_payload, STORE)
update_task = partial(gui_upload_tasks.update_task, STORE, current_timestamp_iso)
append_task_log = partial(gui_upload_tasks.append_task_log, STORE, current_timestamp_iso)
extract_json_result = gui_upload_tasks.extract_json_result


build_task_command = partial(
    gui_upload_tasks.build_task_command,
    workbench_root=WORKBENCH_ROOT,
    build_direct_network_env=lambda: gui_app_utils.build_direct_network_env(PROXY_ENV_KEYS),
    sanitize_ascii_stem=gui_app_utils.sanitize_ascii_stem,
    runtime_output_dir=RUNTIME_OUTPUT_DIR,
    python_executable=sys.executable,
)

detect_stdout_stage = gui_upload_tasks.detect_stdout_stage

run_upload_task = partial(
    gui_upload_tasks.run_upload_task,
    load_settings=load_gui_settings,
    build_task_command_func=build_task_command,
    update_task_func=update_task,
    append_task_log_func=append_task_log,
    extract_json_result_func=extract_json_result,
    find_record_for_output_func=lambda payload: find_record_for_output(payload),
    format_task_command=format_task_command,
    server_instance_id=SERVER_INSTANCE_ID,
    workbench_root=WORKBENCH_ROOT,
)

create_upload_task = partial(
    gui_upload_tasks.create_upload_task,
    uploads_dir=GUI_UPLOADS_DIR,
    store=STORE,
    current_timestamp_iso=current_timestamp_iso,
    server_instance_id=SERVER_INSTANCE_ID,
    sanitize_filename=gui_app_utils.sanitize_filename,
    run_upload_task_func=run_upload_task,
)

create_upload_task_from_path = partial(
    gui_upload_tasks.create_upload_task_from_path,
    uploads_dir=GUI_UPLOADS_DIR,
    store=STORE,
    current_timestamp_iso=current_timestamp_iso,
    server_instance_id=SERVER_INSTANCE_ID,
    sanitize_filename=gui_app_utils.sanitize_filename,
    run_upload_task_func=run_upload_task,
)

zotero_status = gui_zotero.zotero_status


list_zotero_papers = partial(gui_zotero.list_zotero_papers, store=STORE)


_UPLOAD_FACADE = gui_server_uploads.UploadFacade(
    store_getter=lambda: STORE,
    detect_capabilities_getter=lambda: detect_capabilities,
    current_timestamp_iso_getter=lambda: current_timestamp_iso,
    server_instance_id_getter=lambda: SERVER_INSTANCE_ID,
    is_process_alive_getter=lambda: is_process_alive,
    run_upload_task_getter=lambda: run_upload_task,
    create_upload_task_from_path_getter=lambda: create_upload_task_from_path,
    import_lock_getter=lambda: ZOTERO_IMPORT_LOCK,
)

ensure_upload_ready = _UPLOAD_FACADE.ensure_upload_ready
import_zotero_paper = _UPLOAD_FACADE.import_zotero_paper
retry_upload_task = _UPLOAD_FACADE.retry_upload_task


discover_records = partial(
    gui_papers.discover_records,
    runtime_output_dir=RUNTIME_OUTPUT_DIR,
    uuid_dir_re=UUID_DIR_RE,
    encode_paper_id=encode_paper_id,
    record_factory=PaperRecord,
)

serialize_paper_record = gui_papers.serialize_paper_record

deserialize_paper_record = partial(
    gui_papers.deserialize_paper_record,
    record_factory=PaperRecord,
)


load_markdown = gui_papers.load_markdown

ensure_within_root = gui_papers.ensure_within_root

build_images = partial(
    gui_papers.build_images,
    image_suffixes=IMAGE_SUFFIXES,
)

_RECORDS_FACADE = gui_server_records.PaperRecordsFacade(
    store_getter=lambda: STORE,
    memory_root_getter=lambda: MEMORY_ROOT_DIR,
    current_timestamp_iso_getter=lambda: current_timestamp_iso,
    discover_records_getter=lambda: discover_records,
    serialize_record_getter=lambda: serialize_paper_record,
    deserialize_record_getter=lambda: deserialize_paper_record,
    indexed_records_getter=lambda: indexed_records,
    decode_paper_id_getter=lambda: decode_paper_id,
    load_markdown_getter=lambda: load_markdown,
    load_annotations_getter=lambda: load_paper_annotations,
    normalize_text_value_getter=lambda: gui_app_utils.normalize_text_value,
    normalize_string_list_getter=lambda: lambda value: gui_app_utils.normalize_string_list(value, limit=4),
)

find_record_for_output = _RECORDS_FACADE.find_record_for_output
sync_paper_index = _RECORDS_FACADE.sync_paper_index
refresh_record_search_index = _RECORDS_FACADE.refresh_record_search_index
indexed_records = _RECORDS_FACADE.indexed_records
get_record = _RECORDS_FACADE.get_record
load_blocks = _RECORDS_FACADE.load_blocks


build_stats = gui_papers.build_stats


_PAPER_FACADE = gui_server_facades.PaperFacade(
    store=STORE,
    memory_root_getter=lambda: MEMORY_ROOT_DIR,
    timeout_seconds_getter=lambda: COPILOT_RUN_TIMEOUT_SECONDS,
    indexed_records_getter=lambda: indexed_records,
    load_markdown_getter=lambda: load_markdown,
    load_annotations_getter=lambda: load_paper_annotations,
    load_blocks_getter=lambda: load_blocks,
    build_images_getter=lambda: build_images,
)

build_default_reading_state = _PAPER_FACADE.build_default_reading_state
list_paper_copilot_runs = _PAPER_FACADE.list_paper_copilot_runs
search_api_records = _PAPER_FACADE.search_api_records
build_paper_summary = _PAPER_FACADE.build_paper_summary
list_papers = _PAPER_FACADE.list_papers
build_detail = _PAPER_FACADE.build_detail


annotation_preview = gui_annotations.annotation_preview
normalize_annotation_comment = gui_annotations.normalize_annotation_comment


resolve_copilot_agent = gui_copilot.resolve_copilot_agent
render_relevant_chunks = gui_copilot.render_relevant_chunks
resolve_annotation_comment = gui_copilot.resolve_annotation_comment
build_annotation_conversation_context = gui_copilot.build_annotation_conversation_context
resolve_latest_user_comment_for_agent = gui_copilot.resolve_latest_user_comment_for_agent


resolve_agent_relevant_chunks = gui_copilot.resolve_agent_relevant_chunks


request_copilot_completion = gui_copilot.request_copilot_completion


_COPILOT_FACADE = gui_server_facades.CopilotFacade(
    memory_root_getter=lambda: MEMORY_ROOT_DIR,
    load_settings_getter=lambda: load_gui_settings,
    load_annotation_getter=lambda: load_annotation,
    create_annotation_getter=lambda: create_annotation,
    append_annotation_comment_getter=lambda: append_annotation_comment,
    load_copilot_context_cache_getter=lambda: load_copilot_context_cache,
    spawn_worker_getter=lambda: spawn_copilot_run_worker,
    get_record_getter=lambda: get_record,
    indexed_records_getter=lambda: indexed_records,
    invoke_annotation_agent_getter=lambda: invoke_annotation_agent,
    timeout_seconds_getter=lambda: COPILOT_RUN_TIMEOUT_SECONDS,
    load_markdown_getter=lambda: load_markdown,
)

build_copilot_context_cache = _COPILOT_FACADE.build_copilot_context_cache
load_copilot_context_cache = _COPILOT_FACADE.load_copilot_context_cache
build_agent_messages = _COPILOT_FACADE.build_agent_messages
invoke_annotation_agent = _COPILOT_FACADE.invoke_annotation_agent
resolve_copilot_agents_for_run = _COPILOT_FACADE.resolve_copilot_agents_for_run
create_copilot_run = _COPILOT_FACADE.create_copilot_run
retry_copilot_run = _COPILOT_FACADE.retry_copilot_run
spawn_copilot_run_worker = _COPILOT_FACADE.spawn_copilot_run_worker
execute_copilot_run = _COPILOT_FACADE.execute_copilot_run
resume_active_copilot_runs = _COPILOT_FACADE.resume_active_copilot_runs


normalize_annotation_thread = gui_annotations.normalize_annotation_thread


_ANNOTATION_FACADE = gui_server_facades.AnnotationFacade(
    memory_root_getter=lambda: MEMORY_ROOT_DIR,
)

load_paper_annotations = _ANNOTATION_FACADE.load_paper_annotations
annotation_file_path = _ANNOTATION_FACADE.annotation_file_path
load_annotation = _ANNOTATION_FACADE.load_annotation
create_annotation = _ANNOTATION_FACADE.create_annotation
append_annotation_comment = _ANNOTATION_FACADE.append_annotation_comment
update_annotation_comment = _ANNOTATION_FACADE.update_annotation_comment
update_annotation = _ANNOTATION_FACADE.update_annotation
delete_annotation = _ANNOTATION_FACADE.delete_annotation


def import_paper_package(data: bytes) -> dict[str, object]:
    return gui_library_packages.import_paper_package(
        data,
        runtime_output_dir=RUNTIME_OUTPUT_DIR,
        memory_root=MEMORY_ROOT_DIR,
        store=STORE,
        sync_paper_index=sync_paper_index,
        get_record=get_record,
        encode_paper_id=encode_paper_id,
        refresh_record_search_index=refresh_record_search_index,
        build_paper_summary=build_paper_summary,
        current_timestamp_iso=current_timestamp_iso,
    )

resolve_open_target = gui_server_runtime.resolve_open_target

open_in_explorer = partial(
    gui_server_runtime.open_in_explorer,
    startfile=os.startfile,
)

SERVER_BINDINGS = gui_server_bindings.ServerBindings(
    memory_root_getter=lambda: MEMORY_ROOT_DIR,
    runtime_output_dir_getter=lambda: RUNTIME_OUTPUT_DIR,
    store_getter=lambda: STORE,
    current_timestamp_iso_getter=lambda: current_timestamp_iso,
    load_settings_getter=lambda: load_gui_settings,
    detect_capabilities_getter=lambda: detect_capabilities,
    list_tasks_getter=lambda: list_tasks_payload,
    zotero_status_getter=lambda: zotero_status,
    list_zotero_papers_getter=lambda: list_zotero_papers,
    list_papers_getter=lambda: list_papers,
    search_records_getter=lambda: search_api_records,
    save_settings_getter=lambda: save_gui_settings,
    run_connection_test_getter=lambda: run_connection_test,
    ensure_upload_ready_getter=lambda: ensure_upload_ready,
    create_upload_task_getter=lambda: create_upload_task,
    import_zotero_paper_getter=lambda: import_zotero_paper,
    retry_upload_task_getter=lambda: retry_upload_task,
    import_paper_package_getter=lambda: import_paper_package,
    get_record_getter=lambda: get_record,
    resolve_open_target_getter=lambda: resolve_open_target,
    open_in_explorer_getter=lambda: open_in_explorer,
    build_detail_getter=lambda: build_detail,
    load_annotations_getter=lambda: load_paper_annotations,
    build_default_reading_state_getter=lambda: build_default_reading_state,
    list_copilot_runs_getter=lambda: list_paper_copilot_runs,
    resolve_media_path_getter=lambda: ensure_within_root,
    create_annotation_getter=lambda: create_annotation,
    invoke_annotation_agent_getter=lambda: invoke_annotation_agent,
    create_copilot_run_getter=lambda: create_copilot_run,
    retry_copilot_run_getter=lambda: retry_copilot_run,
    load_annotation_getter=lambda: load_annotation,
    append_annotation_comment_getter=lambda: append_annotation_comment,
    refresh_index_getter=lambda: refresh_record_search_index,
    build_paper_summary_getter=lambda: build_paper_summary,
    update_annotation_comment_getter=lambda: update_annotation_comment,
    update_annotation_getter=lambda: update_annotation,
    delete_annotation_getter=lambda: delete_annotation,
)


class GuiRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(GUI_DIST_DIR), **kwargs)

    def log_message(self, format, *args):
        gui_http.log_message(format, *args)

    def end_headers(self):
        origin = self.headers.get("Origin")
        if is_mobile_app_origin(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Accept, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
            self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def read_json_body(self) -> dict[str, object]:
        return gui_http.read_json_body(self)

    def read_binary_body(self) -> bytes:
        return gui_http.read_binary_body(self)

    def write_json(self, payload, *, status: HTTPStatus = HTTPStatus.OK):
        gui_http.write_json(self, payload, status=status)

    def serve_file(self, path: Path):
        gui_http.serve_file(self, path)

    def do_GET(self):
        parsed = urlparse(self.path)
        return gui_server_dispatch.handle_get(
            self,
            parsed,
            gui_dist_dir=GUI_DIST_DIR,
            app_bindings=SERVER_BINDINGS.app_get(),
            papers_bindings=SERVER_BINDINGS.papers_get(),
            handle_assets_get=super().do_GET,
        )

    def do_POST(self):
        parsed = urlparse(self.path)
        return gui_server_dispatch.handle_post(
            self,
            parsed,
            read_json_body=self.read_json_body,
            app_bindings=SERVER_BINDINGS.app_post(),
            papers_bindings=SERVER_BINDINGS.papers_post(),
        )

    def do_PUT(self):
        parsed = urlparse(self.path)
        return gui_server_dispatch.handle_put(
            self,
            parsed,
            read_json_body=self.read_json_body,
            papers_bindings=SERVER_BINDINGS.papers_put(),
        )

    def do_PATCH(self):
        parsed = urlparse(self.path)
        return gui_server_dispatch.handle_patch(
            self,
            parsed,
            read_json_body=self.read_json_body,
            app_bindings=SERVER_BINDINGS.app_patch(),
            papers_bindings=SERVER_BINDINGS.papers_patch(),
        )

    def do_DELETE(self):
        parsed = urlparse(self.path)
        return gui_server_dispatch.handle_delete(
            self,
            parsed,
            app_bindings=SERVER_BINDINGS.app_delete(),
            papers_bindings=SERVER_BINDINGS.papers_delete(),
        )


def build_parser():
    return gui_server_runtime.build_parser()


def prepare_gui_server(
    host: str,
    port: int,
    *,
    store: WorkbenchStore = STORE,
    owner_id: str = SERVER_INSTANCE_ID,
    instance_lock: Optional[SingleInstanceLock] = None,
    server_factory=ThreadingHTTPServer,
):
    return gui_server_runtime.prepare_gui_server(
        host,
        port,
        store=store,
        owner_id=owner_id,
        instance_lock=instance_lock,
        lock_path=INSTANCE_LOCK_PATH,
        lock_factory=SingleInstanceLock,
        server_factory=server_factory,
        handler_class=GuiRequestHandler,
        current_timestamp_iso=current_timestamp_iso,
        sync_paper_index=sync_paper_index,
        resume_active_copilot_runs=resume_active_copilot_runs,
    )


def main():
    return gui_server_runtime.main(
        build_parser_func=build_parser,
        prepare_server_func=prepare_gui_server,
    )


if __name__ == "__main__":
    raise SystemExit(main())
