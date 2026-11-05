# 녹색마을 물품대장

Windows PC 한 대에서 React 화면과 SQLite API를 제공합니다. 서버는 Python 표준 라이브러리를 사용합니다. Node.js와 npm은 화면을 빌드할 때 필요합니다.

## 처음 실행

1. Windows 서버 PC의 로컬 디스크에 프로젝트를 둡니다. Python 3.10 이상과 Node.js 22.12 이상을 설치하고 PATH에 추가합니다.
2. 프로젝트 폴더에서 `npm ci --ignore-scripts`와 `npm run build`를 실행합니다.
3. 기존 대장을 이어서 사용하려면 아래의 초기 이관을 먼저 합니다.
4. `start_inventory.bat`를 더블클릭합니다. 서버가 준비되면 기본 브라우저에서 `http://127.0.0.1:8080`을 엽니다. 서버가 이미 실행 중이면 브라우저만 엽니다. 이 배치 파일의 바로가기를 바탕화면에 만들어도 됩니다.

실행 오류는 `runtime/server.stderr.log`에서 확인합니다. 개발 중 콘솔에서 직접 실행하려면 `python server.py`를 사용합니다.

## 기존 자료 이관

기존 Electron 앱에서 최신 JSON 백업을 내려받습니다. 운영 전환 시에는 기존 앱에서 입력을 멈춘 상태에서 마지막 백업을 받습니다. 기존 파일을 보관한 뒤 프로젝트 폴더에서 아래 명령을 실행합니다.

```powershell
python server.py --import-json "C:\백업\물품대장.json"
```

이관 명령은 아직 저장한 적 없는 SQLite에만 적용됩니다. 가져온 물품, 기관, 날짜별 기록을 브라우저에서 확인한 뒤 직원에게 새 주소를 공유합니다. 운영 SQLite는 서버의 `runtime/inventory.sqlite3`입니다. 웹 화면의 JSON 내보내기도 백업에 사용할 수 있습니다. JSON을 웹 화면으로 다시 불러오면 확인 후 현재 대장 전체를 교체합니다.

## 사내망 접속

기본 설정은 서버 PC에서만 접속을 받습니다. 사내망에서 사용하려면 프로젝트 폴더에 `server.local.json`을 만들고 실제 사내 CIDR과 서버 주소를 지정합니다. 아래 값은 예시입니다.

```json
{
  "port": 8080,
  "allowed_subnets": ["192.168.10.0/24"],
  "allowed_hosts": ["192.168.10.25", "inventory-pc"]
}
```

1. 서버를 재시작합니다. `allowed_subnets`에는 접속을 허용할 사설 IPv4 대역을, `allowed_hosts`에는 직원이 주소창에 사용할 서버 IP 또는 PC 이름을 넣습니다.
2. **서버 PC에서만** 관리자 PowerShell로 인바운드 규칙을 추가합니다. 예시 주소와 포트를 실제 값으로 바꿉니다. 서버의 Windows 네트워크 프로필이 도메인 또는 개인인지 확인합니다.

   ```powershell
   New-NetFirewallRule -DisplayName 'Green Village Inventory' -Direction Inbound -Action Allow `
     -Protocol TCP -LocalPort 8080 -LocalAddress 192.168.10.25 -RemoteAddress 192.168.10.0/24 -Profile Domain,Private
   ```

3. 직원 PC에서 `http://192.168.10.25:8080`처럼 접속합니다. 직원 PC에는 별도 인바운드 규칙이 필요 없습니다. 공유기 포트 포워딩과 외부 프록시 공개는 사용하지 않습니다.

접속이 허용된 PC는 별도 계정 없이 대장을 조회하고 수정할 수 있습니다. 허용 범위는 필요한 직원 네트워크로 좁혀 지정합니다.

## 부팅 시 자동실행

`inventory_autostart.bat`를 서버 계정에서 **관리자 권한으로 실행**합니다.

- **1**은 Windows 부팅 시 서버를 실행하도록 작업 스케줄러에 등록합니다. 서버는 해당 계정의 제한된 권한으로 실행되며 브라우저는 열리지 않습니다.
- **2**는 다음 부팅부터 자동실행을 끕니다.
- **3**은 설정과 작업 상태를 확인합니다.

서버 폴더와 SQLite는 해당 계정이 읽고 쓸 수 있는 로컬 디스크에 둡니다. 부팅 후 접속이 안 되면 작업 스케줄러의 `GreenVillageInventory` 작업 결과와 서버 계정의 배치 로그온 권한을 확인합니다.

## 다른 프로젝트에서 연동

동일한 허용 네트워크에서 `GET /api/v1/inventory`로 `{"revision": 0, "data": {"items": [], "logs": {}, "agencies": []}}` 형태의 스냅샷을 읽습니다. 물품에는 `id`, `name`, `isDeleted`가 있고, `logs`는 날짜별 `id`, `itemId`, `org`, `qty` 기록 배열입니다. `agencies`는 기관명 배열입니다.

`PUT /api/v1/inventory`는 `Content-Type: application/json`과 마지막으로 읽은 `revision`, 변경한 전체 `data`를 받습니다. 저장에 성공하면 새 `revision`을 반환합니다. 다른 사용자가 먼저 저장하면 HTTP 409를 반환하므로 최신 스냅샷을 읽고 변경을 다시 적용합니다. SQLite 파일을 공유 드라이브에 두고 여러 프로그램에서 직접 쓰는 방식은 피합니다.
