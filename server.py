import argparse
import ipaddress
import json
import mimetypes
import re
import socket
import sqlite3
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import unquote, urlsplit

from inventory_store import Conflict, InventoryStore


ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
CONFIG = ROOT / "server.local.json"
API = "/api/v1/inventory"
SQLITE_API = f"{API}/sqlite"
MAX_BODY = 16 * 1024 * 1024
MAX_SQLITE = 64 * 1024 * 1024
PRIVATE_NETWORKS = tuple(ipaddress.ip_network(value) for value in (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"
))


def read_config():
    config = json.loads(CONFIG.read_text(encoding="utf-8-sig")) if CONFIG.exists() else {}
    if not isinstance(config, dict):
        raise ValueError("server.local.json은 JSON 객체여야 합니다.")
    port = config.get("port", 8080)
    if type(port) is not int or not 1 <= port <= 65535:
        raise ValueError("port는 1부터 65535 사이의 정수여야 합니다.")
    subnets = config.get("allowed_subnets", [])
    if not isinstance(subnets, list) or any(not isinstance(value, str) for value in subnets):
        raise ValueError("allowed_subnets는 CIDR 문자열의 배열이어야 합니다.")
    networks = tuple(ipaddress.IPv4Network(value) for value in subnets)
    if any(not any(network.subnet_of(private) for private in PRIVATE_NETWORKS) for network in networks):
        raise ValueError("allowed_subnets에는 사설 IPv4 대역만 지정할 수 있습니다.")
    extra_hosts = config.get("allowed_hosts", [])
    if not isinstance(extra_hosts, list) or any(
        not isinstance(host, str) or not re.fullmatch(r"[a-zA-Z0-9.-]+", host) for host in extra_hosts
    ):
        raise ValueError("allowed_hosts에는 포트 없이 IPv4 주소나 PC 이름을 지정하세요.")
    if networks and not extra_hosts:
        raise ValueError("사내망 접속을 사용하려면 allowed_hosts를 지정하세요.")
    hosts = {"localhost", "127.0.0.1", *(host.lower() for host in extra_hosts)}
    authorities = hosts if port == 80 else set()
    authorities = authorities | {f"{host}:{port}" for host in hosts}
    return port, networks, authorities


class InventoryServer(ThreadingHTTPServer):
    def __init__(self, store, port, networks, authorities):
        self.store = store
        self.networks = networks
        self.authorities = authorities
        super().__init__(("0.0.0.0" if networks else "127.0.0.1", port), Handler)

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.allow_reuse_address = False
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class Handler(BaseHTTPRequestHandler):
    timeout = 15

    def log_request(self, code="-", size="-"):
        if code != "-" and int(code) >= 400:
            super().log_request(code, size)

    def send_bytes(self, status, body, content_type, *, head=False, filename=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def send_json(self, status, data, *, head=False):
        body = json.dumps(data, ensure_ascii=True, allow_nan=False).encode("utf-8")
        self.send_bytes(status, body, "application/json; charset=utf-8", head=head)

    def allowed(self):
        peer = ipaddress.IPv4Address(self.client_address[0])
        host = self.headers.get("Host", "").lower()
        origin = self.headers.get("Origin")
        permitted = (
            (peer.is_loopback or any(peer in net for net in self.server.networks))
            and host in self.server.authorities
            and (origin is None or origin.lower() == f"http://{host}")
        )
        if not permitted:
            self.send_json(HTTPStatus.FORBIDDEN, {"error": "접근이 허용되지 않았습니다."},
                           head=self.command == "HEAD")
        return permitted

    def do_GET(self):
        self.serve_read()

    def do_HEAD(self):
        self.serve_read(head=True)

    def serve_read(self, *, head=False):
        if not self.allowed():
            return
        path = urlsplit(self.path).path
        if path == "/api/health":
            self.send_json(HTTPStatus.OK, {"service": "green-village-inventory"}, head=head)
            return
        if path == API:
            try:
                snapshot = self.server.store.snapshot()
            except sqlite3.Error as error:
                self.database_error(error, head=head)
            else:
                self.send_json(HTTPStatus.OK, snapshot, head=head)
            return
        if path == SQLITE_API:
            try:
                with TemporaryDirectory() as folder:
                    backup = Path(folder) / "inventory.sqlite3"
                    self.server.store.backup(backup)
                    body = backup.read_bytes()
            except (sqlite3.Error, OSError) as error:
                self.database_error(error, head=head)
            else:
                self.send_bytes(HTTPStatus.OK, body, "application/vnd.sqlite3", head=head,
                                filename="green-village-inventory.sqlite3")
            return
        static_path = (DIST / (unquote(path).lstrip("/") or "index.html")).resolve()
        if static_path.is_relative_to(DIST) and static_path.is_file():
            content_type = mimetypes.guess_type(static_path)[0] or "application/octet-stream"
            self.send_bytes(HTTPStatus.OK, static_path.read_bytes(), content_type, head=head)
        else:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "파일을 찾을 수 없습니다."}, head=head)

    def do_PUT(self):
        if not self.allowed():
            return
        if urlsplit(self.path).path != API:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "API를 찾을 수 없습니다."})
            return
        if self.headers.get_content_type() != "application/json":
            self.send_json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "JSON 본문이 필요합니다."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > MAX_BODY:
                self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "파일이 너무 큽니다."})
                return
            if length <= 0:
                raise ValueError("JSON 본문이 필요합니다.")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError("JSON 객체가 필요합니다.")
            revision = self.server.store.replace(payload.get("revision"), payload.get("data"))
        except Conflict:
            self.send_json(HTTPStatus.CONFLICT, {"error": "다른 사용자가 먼저 저장했습니다."})
        except (ValueError, UnicodeError, RecursionError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except sqlite3.Error as error:
            self.database_error(error)
        else:
            self.send_json(HTTPStatus.OK, {"revision": revision})

    def do_POST(self):
        if not self.allowed():
            return
        if urlsplit(self.path).path != SQLITE_API:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "API를 찾을 수 없습니다."})
            return
        if self.headers.get_content_type() != "application/vnd.sqlite3":
            self.send_json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "SQLite 파일이 필요합니다."})
            return
        try:
            revision = int(self.headers.get("X-Inventory-Revision", ""))
            length = int(self.headers.get("Content-Length", "0"))
            if length > MAX_SQLITE:
                self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "SQLite 파일은 64MB까지 올릴 수 있습니다."})
                return
            if revision < 0 or length <= 0:
                raise ValueError("파일과 현재 대장 버전을 확인하세요.")
            body = self.rfile.read(length)
            if len(body) != length or not body.startswith(b"SQLite format 3\x00"):
                raise ValueError("올바른 SQLite 파일이 아닙니다.")
            with TemporaryDirectory() as folder:
                backup = Path(folder) / "restore.sqlite3"
                backup.write_bytes(body)
                revision = self.server.store.restore(revision, backup)
        except Conflict:
            self.send_json(HTTPStatus.CONFLICT, {"error": "다른 사용자가 먼저 저장했습니다."})
        except (ValueError, OverflowError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except (sqlite3.Error, OSError) as error:
            self.database_error(error)
        else:
            self.send_json(HTTPStatus.OK, {"revision": revision})

    def database_error(self, error, *, head=False):
        self.log_error("SQLite: %s", error)
        self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "데이터베이스에 연결할 수 없습니다."},
                       head=head)


def main():
    parser = argparse.ArgumentParser(description="녹색마을 물품대장 웹 서버")
    parser.add_argument("--db", type=Path, default=ROOT / "runtime" / "inventory.sqlite3")
    parser.add_argument("--import-json", type=Path)
    args = parser.parse_args()
    try:
        if args.import_json:
            InventoryStore(args.db).import_json(args.import_json)
            print("SQLite에 가져왔습니다.")
            return
        if not (DIST / "index.html").is_file():
            raise ValueError("먼저 npm ci 및 npm run build를 실행하세요.")
        port, networks, authorities = read_config()
        with InventoryServer(InventoryStore(args.db), port, networks, authorities) as server:
            print(f"녹색마을 물품대장: http://127.0.0.1:{port}", flush=True)
            server.serve_forever()
    except Conflict:
        parser.exit(1, "이관은 새 SQLite 데이터베이스에서만 실행할 수 있습니다.\n")
    except (OSError, ValueError, sqlite3.Error) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
