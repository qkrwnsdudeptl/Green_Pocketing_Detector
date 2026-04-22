// 🔥 'shell'이 반드시 포함되어야 폴더를 열 수 있습니다.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // preload.cjs 파일이 제대로 연결되어 있어야 합니다.
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // 메뉴바 숨기기 & 전체화면
  mainWindow.setMenuBarVisibility(false);
  mainWindow.maximize();

  const isDev = !app.isPackaged;
  const startUrl = isDev 
    ? 'http://localhost:5173' 
    : `file://${path.join(__dirname, 'dist/index.html')}`;

  mainWindow.loadURL(startUrl);
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- 파일 저장 경로 설정 ---
// 🔥 변경됨: 네트워크 공유 폴더 경로 지정 (자바스크립트에서는 역슬래시(\)를 두 번(\\) 써야 인식합니다)
const saveDir = '\\\\192.168.100.235\\공용폴더\\00.청남시니어클럽(2026년)\\04. 직원폴더\\허선경\\DO_NOT_DELETE';
const saveFile = path.join(saveDir, 'data.json');

// 폴더가 없으면 생성 (깊은 경로까지 한 번에 만들 수 있도록 recursive 옵션 추가)
if (!fs.existsSync(saveDir)) {
  fs.mkdirSync(saveDir, { recursive: true });
}

// 1. 데이터 불러오기
ipcMain.handle('load-data', async () => {
  try {
    if (fs.existsSync(saveFile)) {
      const data = fs.readFileSync(saveFile, 'utf-8');
      return JSON.parse(data);
    }
    return null;
  } catch (error) {
    console.error('불러오기 실패:', error);
    return null;
  }
});

// 2. 데이터 저장하기
ipcMain.on('save-data', (event, data) => {
  try {
    fs.writeFileSync(saveFile, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('저장 실패:', error);
  }
});

// 🔥 3. [폴더 열기] 요청 처리 (이 부분이 있어야 버튼이 작동함)
ipcMain.on('open-folder', () => {
  // 저장 경로가 실제로 존재하는지 확인 후 열기
  if (fs.existsSync(saveDir)) {
    shell.openPath(saveDir);
  } else {
    // 만약 폴더가 없다면 새로 만들고 열기
    fs.mkdirSync(saveDir, { recursive: true });
    shell.openPath(saveDir);
  }
});