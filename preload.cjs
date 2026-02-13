const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // 데이터 불러오기
  loadData: () => ipcRenderer.invoke('load-data'),
  // 데이터 저장하기
  saveData: (data) => ipcRenderer.send('save-data', data),
  // 🔥 [이게 추가되어야 합니다] 폴더 열기 기능
  openFolder: () => ipcRenderer.send('open-folder'),
});