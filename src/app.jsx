import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Calendar, Package, Plus, Trash2, Save, X, ChevronLeft, ChevronRight, Printer, Download, Upload, FileJson, AlertTriangle, BarChart3, FileText, FileType, Search, ArrowUp, ArrowDown, CheckCircle, FolderOpen, Building, FileUp, FileDown, RefreshCw } from 'lucide-react';
import { engToKor } from './hangeul.js'; 

const inventoryUrl = '/api/v1/inventory';
const sqliteUrl = `${inventoryUrl}/sqlite`;
const nextId = (records) => records.reduce((next, record) => Math.max(next, record.id + 1), Date.now());

async function inventoryRequest(options, url = inventoryUrl) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(result.error || '서버 요청에 실패했습니다.'), { status: response.status });
  }
  return result;
}

export default function App() {
  const [activeTab, setActiveTab] = useState('calendar'); 
  const [currentDate, setCurrentDate] = useState(new Date()); 
  const [saveStatus, setSaveStatus] = useState(''); 
  const [serverError, setServerError] = useState('');
  const snapshot = useRef(null);
  const saving = useRef(false);
  const electron = window.electron;

  const [items, setItems] = useState([]);
  const [logs, setLogs] = useState({});
  const [agencies, setAgencies] = useState([]);

  const [matchedAgencies, setMatchedAgencies] = useState([]); 
  const [matchIndex, setMatchIndex] = useState(-1); 

  const [isCapsLockOn, setIsCapsLockOn] = useState(false);
  const [inputError, setInputError] = useState('');
  
  const [newItemData, setNewItemData] = useState({ itemId: '', org: '', qty: '' });
  const [newAgencyName, setNewAgencyName] = useState('');
  const [newItemName, setNewItemName] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const showData = useCallback((data) => {
    setItems(data.items || []);
    setLogs(data.logs || {});
    setAgencies(data.agencies || []);
  }, []);

  const showSnapshot = useCallback((next) => {
    if (snapshot.current && next.revision <= snapshot.current.revision) return;
    snapshot.current = next;
    showData(next.data);
  }, [showData]);

  const refresh = useCallback(async (signal) => {
    try {
      if (electron) {
        const data = await electron.loadData();
        if (data && !signal?.aborted) showData(data);
      } else {
        showSnapshot(await inventoryRequest({ signal }));
      }
      if (!signal?.aborted) setServerError('');
    } catch {
      if (!signal?.aborted) setServerError('물품대장을 불러오지 못했습니다. 서버 연결을 확인하세요.');
    }
  }, [electron, showData, showSnapshot]);

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (!saving.current && !isModalOpen && !newItemName && !newAgencyName) refresh(controller.signal);
    }, 5000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [refresh, isModalOpen, newItemName, newAgencyName]);

  const safeSave = async (update, expectedRevision, sqliteFile) => {
    if (saving.current) return false;
    saving.current = true;
    setSaveStatus('');
    setServerError('');
    try {
      if (electron) {
        const latest = await electron.loadData() || { items: [], logs: {}, agencies: [] };
        const data = update(latest);
        electron.saveData(data);
        showData(data);
      } else {
        const base = snapshot.current;
        if (!base) throw new Error('서버에서 데이터를 불러온 뒤 다시 시도하세요.');
        const expected = expectedRevision ?? base.revision;
        if (sqliteFile) {
          await inventoryRequest({
            method: 'POST',
            headers: { 'Content-Type': 'application/vnd.sqlite3', 'X-Inventory-Revision': String(expected) },
            body: sqliteFile,
          }, sqliteUrl);
          await refresh();
        } else {
          const data = update(base.data);
          const { revision } = await inventoryRequest({
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ revision: expected, data }),
          });
          showSnapshot({ revision, data });
        }
      }
      setSaveStatus(sqliteFile ? 'SQLite 복원 완료' : '동기화 완료');
      return true;
    } catch (error) {
      if (error.status === 409) await refresh();
      setServerError(error.status === 409
        ? '다른 사용자가 먼저 저장했습니다. 최신 내용을 확인하고 다시 시도하세요.'
        : `저장 실패: ${error.message}`);
      return false;
    } finally {
      saving.current = false;
    }
  };

  // ESC 키
  useEffect(() => {
    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        setIsModalOpen(false);
        setConfirmModal({ isOpen: false, message: '', onConfirm: null });
        setInputError('');
        setMatchedAgencies([]);
        setMatchIndex(-1);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  const [selectedDate, setSelectedDate] = useState(null);
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, message: '', onConfirm: null });
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const [selectedOrg, setSelectedOrg] = useState('ALL'); 

  // (통계 로직 등은 기존과 동일)
  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days = [];
    for (let i = 0; i < firstDay.getDay(); i++) days.push(null);
    for (let i = 1; i <= lastDay.getDate(); i++) days.push(new Date(year, month, i));
    return days;
  };
  const formatDateKey = (date) => date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : null;
  const isSameDay = (d1, d2) => d1 && d2 && d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
  const getMonthlyStats = () => { /* ... */ const stats={}; getDaysInMonth(currentDate).forEach(day=>{const k=formatDateKey(day);if(logs[k])logs[k].forEach(l=>{const i=items.find(it=>it.id===l.itemId);const n=i?i.name:'알 수 없음';stats[n]=(stats[n]||0)+l.qty;})}); return stats; };
  const getMonthlyReport = () => { /* ... */ const y=currentDate.getFullYear(),m=currentDate.getMonth()+1;const ml=[];Object.keys(logs).forEach(k=>{const[ly,lm,ld]=k.split('-').map(Number);if(ly===y&&lm===m)logs[k].forEach(l=>ml.push({...l,date:k,day:ld}));});const rd={};items.forEach(i=>{const il=ml.filter(l=>l.itemId===i.id);if(il.length>0)rd[i.id]={name:i.name,logs:il.sort((a,b)=>a.day-b.day),totalQty:il.reduce((s,l)=>s+l.qty,0)};});return rd; };
  const getYearlyOrgStats = () => { /* ... */ const y=currentDate.getFullYear();const al=[];Object.keys(logs).forEach(k=>{const[ly,lm,ld]=k.split('-').map(Number);if(ly===y)logs[k].forEach(l=>al.push({...l,dateKey:k,month:lm,day:ld}));});const ao=Array.from(new Set(al.map(l=>l.org))).sort();const fl=selectedOrg==='ALL'?al:al.filter(l=>l.org===selectedOrg);const gd={};fl.forEach(l=>{if(!gd[l.org])gd[l.org]={logs:[],totalQty:0};gd[l.org].logs.push(l);gd[l.org].totalQty+=l.qty;});Object.values(gd).forEach(d=>d.logs.sort((a,b)=>a.month!==b.month?a.month-b.month:a.day-b.day));return{allOrgs:ao,sortedGroupedData:Object.entries(gd).sort(([,a],[,b])=>b.totalQty-a.totalQty),totalCount:fl.length}; };
  const handleExportWord = () => { /* ...기존과 완전 동일... */ };

  const handleDayClick = (date) => {
    if (!date) return;
    setSelectedDate(formatDateKey(date));
    setIsModalOpen(true);
    setInputError('');
    setMatchedAgencies([]);
    setMatchIndex(-1);
    const firstValidItem = items.find(i => !i.isDeleted);
    setNewItemData({ itemId: firstValidItem?.id || '', org: '', qty: '' });
  };

  // 🔥 [수정] 달력 기록 추가 시 (Safe Save 적용)
  const handleAddItem = async () => {
    if (!newItemData.itemId) { setInputError("물품을 선택해주세요."); return; }
    if (!newItemData.qty || Number(newItemData.qty) <= 0) { setInputError("수량은 1개 이상 입력해야 합니다!"); return; }
    setInputError(''); 

    const saved = await safeSave((latestData) => {
      const itemId = Number(newItemData.itemId);
      if (!latestData.items.some((item) => item.id === itemId && !item.isDeleted)) {
        throw new Error('목록에 있는 물품을 다시 선택하세요.');
      }
      const currentLogs = latestData.logs || {};
      const entries = currentLogs[selectedDate] || [];
      const newEntry = { id: nextId(entries), itemId, org: newItemData.org, qty: Number(newItemData.qty) };
      return {
        ...latestData,
        logs: { ...currentLogs, [selectedDate]: [...entries, newEntry] }
      };
    });
    if (!saved) return;

    const firstValidItem = items.find(i => !i.isDeleted);
    setNewItemData((current) => current === newItemData
      ? { itemId: firstValidItem?.id || '', org: '', qty: '' }
      : current);
    setMatchedAgencies([]); 
    setMatchIndex(-1);
  };

  const checkCapsLock = (e) => { if (e && e.getModifierState) setIsCapsLockOn(e.getModifierState('CapsLock')); };

  const handleKeyDown = (e) => {
    checkCapsLock(e.nativeEvent || e); 
    if ((e.key === 'Tab' || e.keyCode === 9) && matchedAgencies.length > 0) {
      e.preventDefault(); 
      const nextIndex = (matchIndex + 1) % matchedAgencies.length; 
      setMatchIndex(nextIndex);
      setNewItemData(prev => ({ ...prev, org: matchedAgencies[nextIndex] }));
    }
    else if (e.key === 'Enter') {
      if (e.nativeEvent && e.nativeEvent.isComposing) return; 
      handleAddItem();
    }
  };

  // 🔥 [수정] 달력 기록 삭제 시 (Safe Save 적용)
  const handleDeleteEntry = (dateKey, entryId) => {
    setConfirmModal({
      isOpen: true,
      message: '정말 이 기록을 삭제하시겠습니까?',
      onConfirm: async () => {
        const saved = await safeSave((latestData) => {
          const currentLogs = latestData.logs || {};
          return {
            ...latestData,
            logs: { ...currentLogs, [dateKey]: (currentLogs[dateKey] || []).filter(e => e.id !== entryId) }
          };
        });
        if (saved) setConfirmModal({ isOpen: false, message: '', onConfirm: null });
      }
    });
  };

  // 🔥 [수정] 기관 추가 시 (Safe Save 적용)
  const handleAddAgency = async () => {
    const name = newAgencyName.trim();
    if (!name) return;
    const saved = await safeSave((latestData) => {
      const names = latestData.agencies || [];
      if (names.includes(name)) throw new Error('이미 등록된 기관입니다.');
      return { ...latestData, agencies: [...names, name] };
    });
    if (saved) setNewAgencyName((current) => current === newAgencyName ? '' : current);
  };

  // 🔥 [수정] 기관 삭제 시 (Safe Save 적용)
  const handleDeleteAgency = (targetName) => {
    if (confirm(`'${targetName}'을(를) 목록에서 삭제하시겠습니까?`)) {
      safeSave((latestData) => {
        return { ...latestData, agencies: (latestData.agencies || []).filter(name => name !== targetName) };
      });
    }
  };

  const handleExportAgenciesTxt = () => {
    if (agencies.length === 0) { alert("내보낼 기관 목록이 없습니다."); return; }
    const content = agencies.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `기관목록_${new Date().toISOString().slice(0,10)}.txt`; document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleImportAgenciesTxt = (file) => {
    if (!file) return;
    const revision = snapshot.current?.revision;
    if (!confirm("주의: 불러오는 파일의 내용으로 현재 기관 목록을 완전히 덮어씁니다.\n기존 목록은 삭제됩니다. 진행하시겠습니까?")) return; 

    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target.result;
      const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0); 
      const uniqueLines = [...new Set(lines)];
      
      if (uniqueLines.length === 0) alert("파일에 유효한 내용이 없습니다.");
      else {
        const saved = await safeSave((latestData) => ({ ...latestData, agencies: uniqueLines }), revision);
        if (saved) alert(`${uniqueLines.length}개의 기관으로 목록이 교체되었습니다.`);
      }
    };
    reader.readAsText(file);
  };

  // 🔥 [수정] 물품 목록 삭제 시 (Safe Save 적용)
  const handleDeleteItem = (id) => {
    setConfirmModal({
      isOpen: true,
      message: '목록에서 삭제하시겠습니까? (기존 대장 기록은 유지됩니다)',
      onConfirm: async () => {
        const saved = await safeSave((latestData) => {
          return { ...latestData, items: (latestData.items || []).map(i => i.id === id ? { ...i, isDeleted: true } : i) };
        });
        if (saved) setConfirmModal({ isOpen: false, message: '', onConfirm: null });
      }
    });
  };

  // 🔥 [수정] 물품 순서 변경 시 (Safe Save 적용)
  const handleMoveItem = (id, direction) => {
    safeSave((latestData) => {
      const newItems = [...(latestData.items || [])];
      const index = newItems.findIndex((item) => item.id === id && !item.isDeleted);
      if (index === -1) throw new Error('목록에 있는 물품을 다시 선택하세요.');
      const step = direction === 'up' ? -1 : 1;
      let target = index + step;
      while (newItems[target]?.isDeleted) target += step;
      if (newItems[target]) {
        [newItems[index], newItems[target]] = [newItems[target], newItems[index]];
      }
      return { ...latestData, items: newItems };
    });
  };

  // 🔥 [수정] 물품 생성 시 (Safe Save 적용)
  const handleCreateItem = async () => {
    if (!newItemName.trim()) return;
    const saved = await safeSave((latestData) => {
      const items = latestData.items || [];
      return { ...latestData, items: [...items, { id: nextId(items), name: newItemName, isDeleted: false }] };
    });
    if (saved) setNewItemName((current) => current === newItemName ? '' : current);
  };

  const processFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.logs && data.items) {
          const revision = snapshot.current?.revision;
          setConfirmModal({
            isOpen: true,
            message: '파일을 불러오면 현재 작성 중인 내용이 덮어씌워집니다. 진행하시겠습니까?',
            onConfirm: async () => {
              const saved = await safeSave(() => ({ ...data, agencies: data.agencies || [] }), revision);
              if (saved) setActiveTab('calendar');
              setConfirmModal({ isOpen: false, message: '', onConfirm: null });
            }
          });
        } else { alert('올바른 데이터 파일 형식이 아닙니다.'); }
      } catch { alert('파일을 읽는 중 오류가 발생했습니다.'); }
    };
    reader.readAsText(file);
  };

  const handleDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); dragCounter.current += 1; if (e.dataTransfer.items && e.dataTransfer.items.length > 0) setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); dragCounter.current -= 1; if (dragCounter.current === 0) setIsDragging(false); };
  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); dragCounter.current = 0; if (e.dataTransfer.files && e.dataTransfer.files.length > 0) { processFile(e.dataTransfer.files[0]); e.dataTransfer.clearData(); } };
  const handlePrint = () => window.print();
  
  const handleDownloadData = () => {
    const data = { logs: logs, items: items, agencies: agencies, exportDate: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `물품대장_백업_${new Date().toISOString().slice(0,10)}.json`; document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleRestoreSqlite = (file) => {
    if (!file) return;
    const revision = snapshot.current?.revision;
    if (revision === undefined) {
      setServerError('현재 대장을 불러온 뒤 다시 시도하세요.');
      return;
    }
    setConfirmModal({
      isOpen: true,
      message: `“${file.name}” 파일로 현재 서버의 물품, 기관, 기록을 모두 교체할까요?`,
      onConfirm: async () => {
        await safeSave(null, revision, file);
        setConfirmModal({ isOpen: false, message: '', onConfirm: null });
      },
    });
  };

  const today = new Date();
  const reportData = getMonthlyReport();
  const yearlyStats = getYearlyOrgStats();
  const getItemName = (id) => items.find(i => i.id === id)?.name || '삭제된 품목';

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-slate-800 font-sans print:bg-white print:h-auto relative p-4 md:p-6 overflow-hidden"
      onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}
    >
      <div className="max-w-7xl mx-auto w-full bg-white shadow-md rounded-lg flex flex-col h-full relative overflow-hidden print:h-auto print:shadow-none print:p-0 print:overflow-visible p-4 md:p-6">
        
        {isDragging && (
          <div className="absolute inset-0 z-[100] bg-emerald-600/90 flex flex-col items-center justify-center text-white backdrop-blur-sm transition-all duration-300 pointer-events-none rounded-lg">
            <Upload className="w-20 h-20 mb-4 animate-bounce" />
            <h2 className="text-3xl font-bold">파일을 여기에 놓으세요</h2>
            <p className="mt-2 text-emerald-100">데이터가 자동으로 로드됩니다</p>
          </div>
        )}

        <style>{`@media print { @page { size: A4; margin: 15mm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .no-print { display: none !important; } .print-full { height: auto !important; overflow: visible !important; width: 100% !important; } .print-text-black { color: black !important; } .print-border-black { border-color: black !important; } .break-inside-avoid { break-inside: avoid; } }`}</style>

        {/* Header */}
        <header className="bg-emerald-600 text-white p-4 shadow-md flex justify-between items-center rounded-lg mb-4 no-print shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Calendar className="w-6 h-6" />
              녹색마을만들기 물품 대장
            </h1>
            {saveStatus && (
              <span className="text-xs bg-emerald-800 text-emerald-100 px-2 py-1 rounded animate-pulse flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> {saveStatus}
              </span>
            )}
            {serverError && <span role="alert" className="text-xs bg-red-800 px-2 py-1 rounded">{serverError}</span>}
          </div>
          <div className="flex gap-2">
             <button onClick={handlePrint} className="px-4 py-2 rounded-lg text-sm font-bold bg-emerald-700 text-emerald-100 hover:bg-emerald-500 flex items-center gap-2">
              <Printer className="w-4 h-4" /> 인쇄
            </button>
            {activeTab === 'report' && (
              <button onClick={handleExportWord} className="px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-500 flex items-center gap-2">
                <FileType className="w-4 h-4" /> Word 저장
              </button>
            )}
            <div className="h-8 w-px bg-emerald-500 mx-2"></div>
            <button onClick={() => setActiveTab('calendar')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === 'calendar' ? 'bg-white text-emerald-700' : 'bg-emerald-700 text-emerald-100 hover:bg-emerald-500'}`}>
              📅 달력 대장
            </button>
            <button onClick={() => setActiveTab('report')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-1 ${activeTab === 'report' ? 'bg-white text-emerald-700' : 'bg-emerald-700 text-emerald-100 hover:bg-emerald-500'}`}>
              <FileText className="w-4 h-4" /> 월별 보고서
            </button>
            <button onClick={() => setActiveTab('stats')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-1 ${activeTab === 'stats' ? 'bg-white text-emerald-700' : 'bg-emerald-700 text-emerald-100 hover:bg-emerald-500'}`}>
              <BarChart3 className="w-4 h-4" /> 연간 통계
            </button>
            <button onClick={() => setActiveTab('items')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === 'items' ? 'bg-white text-emerald-700' : 'bg-emerald-700 text-emerald-100 hover:bg-emerald-500'}`}>
              📦 품목 관리
            </button>
            <button onClick={() => setActiveTab('agencies')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-1 ${activeTab === 'agencies' ? 'bg-white text-emerald-700' : 'bg-emerald-700 text-emerald-100 hover:bg-emerald-500'}`}>
              <Building className="w-4 h-4" /> 기관 관리
            </button>
            <button onClick={() => setActiveTab('data')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === 'data' ? 'bg-white text-emerald-700' : 'bg-emerald-700 text-emerald-100 hover:bg-emerald-500'}`}>
              💾 데이터 관리
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-hidden print:p-0 print:overflow-visible flex flex-col">
          {activeTab !== 'data' && activeTab !== 'agencies' && (
            <div className="p-4 flex justify-between items-center bg-white rounded-t-xl border-b border-gray-200 no-print shrink-0">
              <div className="flex items-center gap-4">
                <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))} className="p-1 hover:bg-gray-100 rounded-full"><ChevronLeft /></button>
                <h2 className="text-2xl font-bold text-gray-800">{currentDate.getFullYear()}년 {activeTab === 'stats' ? '' : `${currentDate.getMonth() + 1}월`}</h2>
                <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))} className="p-1 hover:bg-gray-100 rounded-full"><ChevronRight /></button>
                <button onClick={() => setCurrentDate(new Date())} className="ml-2 text-xs bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full font-bold hover:bg-emerald-200 transition-colors">{activeTab === 'stats' ? '올해' : '이번 달'}</button>
              </div>
              <div className="text-sm text-gray-500">
                {activeTab === 'calendar' ? '* 날짜를 클릭하여 기록 / 상단 [인쇄] 버튼으로 출력' : activeTab === 'report' ? '* 우측 상단 [Word 저장]을 눌러 편집 가능한 파일로 저장하세요.' : activeTab === 'stats' ? '* 연간 전체 기록을 기관별로 조회하고 인쇄합니다.' : ''}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-auto h-full">
            {activeTab === 'calendar' && (
              <div className="h-full flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 print:border-none print:shadow-none print:h-auto">
                <div className="bg-emerald-50 p-3 border-b border-emerald-100 flex items-center gap-4 overflow-x-auto no-print shrink-0">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold whitespace-nowrap"><BarChart3 className="w-5 h-5" /><span>이번 달 통계:</span></div>
                  <div className="flex gap-3 text-sm">
                    {Object.keys(getMonthlyStats()).length > 0 ? (
                      Object.entries(getMonthlyStats()).map(([name, qty]) => (
                        <span key={name} className="bg-white px-2 py-1 rounded border border-emerald-200 text-emerald-700 whitespace-nowrap">{name} <span className="font-bold text-black">{qty}개</span></span>
                      ))
                    ) : ( <span className="text-gray-400 text-xs py-1">아직 기록이 없습니다.</span> )}
                  </div>
                </div>
                <div className="hidden print:block text-center py-4 border-b border-black mb-4"><h1 className="text-2xl font-bold text-black">{currentDate.getFullYear()}년 {currentDate.getMonth() + 1}월 물품 불출 달력</h1></div>
                <div className="grid grid-cols-7 text-center py-2 bg-gray-50 border-b border-gray-200 font-bold text-gray-600 print:bg-white print:text-black print:border-black shrink-0">
                  <div className="text-red-500">일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div className="text-blue-500">토</div>
                </div>
                <div className="grid grid-cols-7 flex-1 auto-rows-fr overflow-auto bg-gray-200 gap-px border border-gray-200 print:bg-black print:border-black print:gap-[1px] print:overflow-visible print:h-auto">
                  {getDaysInMonth(currentDate).map((date, idx) => {
                    const dateKey = formatDateKey(date);
                    const dayLogs = dateKey ? logs[dateKey] : [];
                    const isToday = isSameDay(date, today);
                    return (
                      <div key={idx} onClick={() => handleDayClick(date)} className={`bg-white min-h-[100px] p-2 flex flex-col gap-1 transition-colors hover:bg-emerald-50 cursor-pointer ${!date ? 'bg-gray-50 print:bg-white' : ''} ${isToday ? 'bg-blue-50/50 print:bg-white' : ''} print:min-h-[120px] print:block relative overflow-hidden group`}>
                        {date && (
                          <>
                            <div className="flex justify-between items-start shrink-0">
                              <span className={`text-sm font-bold flex items-center justify-center w-7 h-7 print:text-black ${isToday ? 'bg-blue-600 text-white rounded-full shadow-md print:bg-transparent print:border print:border-black print:text-black' : date.getDay() === 0 ? 'text-red-500' : date.getDay() === 6 ? 'text-blue-500' : 'text-gray-700'}`}>{date.getDate()}</span>
                            </div>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-1 mt-1 overflow-y-auto max-h-[140px] pr-1 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent print:max-h-none print:overflow-visible print:block">
                              {dayLogs && dayLogs.map((log) => (
                                <div key={log.id} className="text-xs bg-emerald-100 text-emerald-800 p-1 rounded border border-emerald-200 print:bg-white print:border-none print:text-black print:p-0 print:mb-1">
                                  <div className="flex flex-col print:block">
                                    <span className="font-bold whitespace-normal break-words leading-tight">[{getItemName(log.itemId)}]</span>
                                    <span className="print:hidden h-px bg-emerald-200 my-0.5"></span>
                                    <span className="whitespace-normal break-words leading-tight text-[11px]">{log.org} ({log.qty}개)</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === 'report' && (
              <div className="min-h-full bg-white rounded-xl shadow-sm border border-gray-200 p-8 print:p-0 print:border-none print:shadow-none print:w-full">
                <div className="text-center mb-10 pb-4 border-b-2 border-gray-800 print:mb-6"><h1 className="text-3xl font-bold text-gray-900 print:text-black">{currentDate.getFullYear()}년 {currentDate.getMonth() + 1}월 물품 수불 대장</h1></div>
                {Object.keys(reportData).length > 0 ? (
                  <div className="space-y-8 print:space-y-6">
                    {Object.values(reportData).map(data => (
                      <div key={data.name} className="break-inside-avoid">
                        <div className="flex justify-between items-center mb-2 px-2 border-l-4 border-gray-800 bg-gray-100 py-2 print:bg-gray-50 print:border-black"><h3 className="text-lg font-bold text-gray-800 print:text-black">{data.name}</h3><span className="font-bold text-emerald-700 print:text-black">총 {data.totalQty}개 출고</span></div>
                        <table className="w-full text-sm text-left border-collapse border border-gray-300 print:border-black">
                          <thead className="bg-gray-50 print:bg-gray-100"><tr><th className="py-2 pl-4 w-1/5 border-b border-r border-gray-300 print:border-black">일자</th><th className="py-2 pl-4 w-3/5 border-b border-r border-gray-300 print:border-black">제공 기관 (사용처)</th><th className="py-2 pr-4 text-right w-1/5 border-b border-gray-300 print:border-black">수량</th></tr></thead>
                          <tbody>
                            {data.logs.map(log => (
                              <tr key={log.id} className="border-b border-gray-200 hover:bg-gray-50 print:border-black"><td className="py-2 pl-4 border-r border-gray-200 print:border-black text-gray-700 print:text-black">{currentDate.getMonth() + 1}월 {log.day}일</td><td className="py-2 pl-4 border-r border-gray-200 print:border-black font-medium text-gray-900 print:text-black">{log.org}</td><td className="py-2 pr-4 text-right text-gray-900 print:text-black">{log.qty}</td></tr>
                            ))}
                            <tr className="bg-gray-50 font-bold print:bg-white"><td colSpan="2" className="py-2 pr-4 text-right border-r border-gray-200 print:border-black print:text-black">월계</td><td className="py-2 pr-4 text-right text-emerald-700 print:text-black border-t border-gray-300 print:border-black">{data.totalQty}</td></tr>
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                ) : ( <div className="flex flex-col items-center justify-center h-64 text-gray-400"><FileText className="w-12 h-12 mb-2 opacity-50" /><p>해당 월에 기록된 물품 출고 내역이 없습니다.</p></div> )}
              </div>
            )}

            {activeTab === 'stats' && (
              <div className="h-full bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col print:border-none print:shadow-none print:w-full print:h-auto print:block">
                <div className="p-6 pb-0 print:hidden shrink-0">
                  <div className="flex flex-col md:flex-row gap-4 items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex items-center gap-3 w-full md:w-auto"><Search className="w-5 h-5 text-gray-400" /><span className="font-bold text-gray-700 whitespace-nowrap">기관 선택:</span>
                       <select value={selectedOrg} onChange={(e) => setSelectedOrg(e.target.value)} className="w-full md:w-64 border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
                         <option value="ALL">전체 기관 (많이 가져간 순)</option>{yearlyStats.allOrgs.map(org => (<option key={org} value={org}>{org}</option>))}
                       </select>
                    </div>
                    <div className="text-sm text-gray-500">총 <strong className="text-emerald-600">{yearlyStats.totalCount}건</strong>의 기록이 조회되었습니다.</div>
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-6 pt-6 print:p-0 print:overflow-visible">
                  <div className="text-center mb-10 pb-4 border-b-2 border-gray-800 print:mb-6"><h1 className="text-3xl font-bold text-gray-900 print:text-black">{currentDate.getFullYear()}년도 기관별 물품 수불 통계</h1><p className="text-gray-500 mt-2 print:text-black">조회 기준: {selectedOrg === 'ALL' ? '전체 기관 (수령량 내림차순)' : selectedOrg}</p></div>
                  {yearlyStats.sortedGroupedData.length > 0 ? (
                    <div className="space-y-8 print:space-y-6 pb-10">
                      {yearlyStats.sortedGroupedData.map(([orgName, data]) => (
                        <div key={orgName} className="break-inside-avoid shadow-sm border border-gray-200 rounded-lg overflow-hidden print:shadow-none print:border-none print:rounded-none">
                          <div className="flex justify-between items-center px-4 py-3 bg-emerald-50 border-b border-emerald-100 print:bg-gray-100 print:border-black print:border-b-2"><h3 className="text-xl font-bold text-gray-900 print:text-black flex items-center gap-2">{orgName}<span className="text-xs font-normal text-gray-500 bg-white px-2 py-0.5 rounded-full border border-gray-200 print:hidden">{data.logs.length}건 기록</span></h3><span className="text-lg font-bold text-emerald-700 print:text-black">총 {data.totalQty}개 수령</span></div>
                          <table className="w-full text-sm text-left border-collapse print:border-black">
                            <thead className="bg-gray-50 text-gray-600 print:bg-gray-50 print:text-black"><tr><th className="py-2 pl-4 w-1/4 border-b border-r border-gray-200 print:border-black font-semibold">날짜</th><th className="py-2 pl-4 w-2/4 border-b border-r border-gray-200 print:border-black font-semibold">품목명</th><th className="py-2 pr-4 text-right w-1/4 border-b border-gray-200 print:border-black font-semibold">수량</th></tr></thead>
                            <tbody className="divide-y divide-gray-100">{data.logs.map((log, idx) => (<tr key={`${log.id}-${idx}`} className="hover:bg-gray-50 print:border-b print:border-gray-300"><td className="py-2 pl-4 border-r border-gray-100 print:border-black text-gray-700 print:text-black">{log.month}월 {log.day}일</td><td className="py-2 pl-4 border-r border-gray-100 print:border-black font-medium text-gray-900 print:text-black">{getItemName(log.itemId)}</td><td className="py-2 pr-4 text-right text-gray-900 print:text-black font-bold">{log.qty}</td></tr>))}</tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  ) : ( <div className="flex flex-col items-center justify-center h-64 text-gray-400"><BarChart3 className="w-12 h-12 mb-2 opacity-50" /><p>해당 연도에 기록된 내역이 없습니다.</p></div> )}
                </div>
              </div>
            )}

            {activeTab === 'items' && (
              <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-6 no-print h-full flex flex-col">
                <h2 className="text-lg font-bold mb-4 flex items-center gap-2 shrink-0"><Package className="w-5 h-5 text-emerald-600" />물품 목록 관리</h2>
                 <div className="flex gap-2 mb-6 shrink-0">
                  <input type="text" value={newItemName} onChange={(e) => setNewItemName(e.target.value)} placeholder="새 물품명 입력" className="flex-1 border border-gray-300 rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500" onKeyPress={(e) => e.key === 'Enter' && handleCreateItem()} />
                  <button onClick={handleCreateItem} className="bg-emerald-600 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2"><Plus className="w-4 h-4" /> 추가</button>
                </div>
                <div className="flex-1 overflow-y-auto pb-24 space-y-2 pr-1">
                  {items.map((item) => {
                    if (item.isDeleted) return null;
                    return (
                      <div key={item.id} className="flex justify-between items-center p-3 bg-white border border-gray-100 rounded-lg shadow-sm hover:border-emerald-200 transition-colors">
                        <span className="font-medium text-gray-700">{item.name}</span>
                        <div className="flex items-center gap-1">
                          <div className="flex flex-col mr-2"><button onClick={() => handleMoveItem(item.id, 'up')} className="p-1 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded" title="위로 이동"><ArrowUp className="w-3 h-3" /></button><button onClick={() => handleMoveItem(item.id, 'down')} className="p-1 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded" title="아래로 이동"><ArrowDown className="w-3 h-3" /></button></div>
                          <button onClick={() => handleDeleteItem(item.id)} className="text-red-400 hover:text-red-600 p-2 rounded-full hover:bg-red-50" title="삭제"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                    );
                  })}
                  <div className="text-center text-xs text-gray-400 py-4">* 순서 변경 화살표를 눌러 대장에 표시될 순서를 조정하세요.</div>
                </div>
              </div>
            )}

            {/* 기관 관리 탭 */}
            {activeTab === 'agencies' && (
              <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-6 no-print h-full flex flex-col">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-bold flex items-center gap-2 shrink-0"><Building className="w-5 h-5 text-emerald-600" />기관 목록 관리</h2>
                  
                  <div className="flex gap-2">
                    <button onClick={handleExportAgenciesTxt} className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 hover:bg-gray-200">
                      <FileDown className="w-3 h-3" /> 목록 내보내기
                    </button>
                    <label className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 hover:bg-gray-200 cursor-pointer">
                      <FileUp className="w-3 h-3" /> 목록 불러오기
                      <input type="file" accept=".txt" className="hidden" onChange={(e) => handleImportAgenciesTxt(e.target.files[0])} />
                    </label>
                  </div>
                </div>

                <p className="text-sm text-gray-500 mb-4">자주 사용하는 기관명을 등록해두면, 기록할 때 자동완성 기능을 사용할 수 있습니다.</p>
                 <div className="flex gap-2 mb-6 shrink-0">
                  <input 
                    type="text" 
                    value={newAgencyName} 
                    onChange={(e) => {
                        const converted = engToKor(e.target.value);
                        setNewAgencyName(converted);
                    }} 
                    placeholder="새 기관명 입력 (예: 가덕복지회관)" 
                    className="flex-1 border border-gray-300 rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500" 
                    onKeyPress={(e) => e.key === 'Enter' && handleAddAgency()} 
                  />
                  <button onClick={handleAddAgency} className="bg-emerald-600 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2"><Plus className="w-4 h-4" /> 추가</button>
                </div>
                <div className="flex-1 overflow-y-auto pb-24 space-y-2 pr-1">
                  {agencies.length > 0 ? (
                    agencies.map((agency, index) => (
                      <div key={index} className="flex justify-between items-center p-3 bg-white border border-gray-100 rounded-lg shadow-sm hover:border-emerald-200 transition-colors">
                        <span className="font-medium text-gray-700">{agency}</span>
                        <button onClick={() => handleDeleteAgency(agency)} className="text-red-400 hover:text-red-600 p-2 rounded-full hover:bg-red-50" title="삭제"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    ))
                  ) : (
                    <div className="text-center text-gray-400 py-10">등록된 기관이 없습니다.</div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'data' && (
              <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-6 no-print h-full overflow-y-auto">
                <h2 className="text-lg font-bold mb-6 flex items-center gap-2"><Save className="w-5 h-5 text-emerald-600" />데이터 저장 및 불러오기</h2>
                <div className="grid gap-6">
                  <div className="p-4 border border-blue-100 bg-blue-50 rounded-lg">
                    <h3 className="font-bold text-blue-800 mb-2 flex items-center gap-2"><RefreshCw className="w-4 h-4" /> 수동 동기화 및 덮어쓰기</h3>
                    {/* 🔥 문구 수정됨 */}
                    <p className="text-sm text-blue-600 mb-4">
                      {electron ? '변경사항은 공유 폴더에 저장됩니다.' : '변경사항은 서버의 SQLite에 저장됩니다.'}
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => refresh()} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-700 flex items-center gap-2">최신 데이터 불러오기</button>
                      {electron && (
                        <button onClick={() => electron.openFolder()} className="bg-white text-blue-600 border border-blue-600 px-4 py-2 rounded-lg font-bold hover:bg-blue-50 flex items-center gap-2">
                          <FolderOpen className="w-4 h-4" /> 저장 폴더 열기
                        </button>
                      )}
                    </div>
                  </div>

                  {!electron && (
                    <div className="p-4 border border-emerald-100 bg-emerald-50 rounded-lg">
                      <h3 className="font-bold text-emerald-800 mb-2">서버 이전용 SQLite 백업</h3>
                      <p className="text-sm text-emerald-600 mb-4">기존 서버에서 파일을 내려받고 새 서버에서 불러오세요. 복원하면 새 서버의 현재 대장 전체가 교체됩니다.</p>
                      <a href={sqliteUrl} className="inline-flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-emerald-700">
                        <Download className="w-4 h-4" /> SQLite 백업 다운로드
                      </a>
                      <label className="block mt-4 text-sm font-bold text-emerald-800">
                        SQLite 파일 불러오기
                        <input type="file" accept=".sqlite3,.sqlite,.db" className="block mt-2 w-full"
                          onChange={(e) => { handleRestoreSqlite(e.target.files[0]); e.target.value = ''; }} />
                      </label>
                    </div>
                  )}
                  <div className="p-4 border border-emerald-100 bg-emerald-50 rounded-lg">
                    <h3 className="font-bold text-emerald-800 mb-2 flex items-center gap-2"><Download className="w-4 h-4" /> 내 컴퓨터에 로컬 백업 파일 다운로드</h3>
                    <p className="text-sm text-emerald-600 mb-4">현재 기록된 전체 데이터를 별도의 로컬 백업 파일(.json)로 내려받습니다.</p>
                    <button onClick={handleDownloadData} className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-emerald-700 flex items-center gap-2"><FileJson className="w-4 h-4" /> 대장 파일 다운로드</button>
                  </div>
                  <div className="p-4 border border-gray-200 bg-white rounded-lg">
                    <h3 className="font-bold text-gray-800 mb-2 flex items-center gap-2"><Upload className="w-4 h-4" /> 파일 불러오기 (전체 덮어쓰기)</h3>
                    <p className="text-sm text-gray-500 mb-4">저장해둔 백업 파일을 불러옵니다.<br/><span className="text-red-500 font-bold">주의: 현재 대장 전체가 이 파일의 내용으로 교체됩니다.</span></p>
                    <input type="file" onChange={(e) => { processFile(e.target.files[0]); e.target.value = ''; }} accept=".json" className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 no-print">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-emerald-600 text-white p-4 flex justify-between items-center"><h3 className="font-bold text-lg flex items-center gap-2"><Calendar className="w-5 h-5" />{selectedDate} 기록</h3><button onClick={() => setIsModalOpen(false)} className="hover:bg-emerald-700 p-1 rounded"><X className="w-5 h-5" /></button></div>
            <div className="p-6 space-y-4">
              <div className="bg-gray-50 rounded-lg p-3 min-h-[100px] max-h-[150px] overflow-y-auto mb-4 border border-gray-200">
                <h4 className="text-xs font-bold text-gray-500 mb-2 uppercase">등록된 내역</h4>
                {logs[selectedDate]?.length > 0 ? (
                  <div className="space-y-2">{logs[selectedDate].map(log => (<div key={log.id} className="flex justify-between items-center bg-white p-2 rounded border border-gray-200 shadow-sm text-sm"><div className="flex flex-col"><span className="font-bold text-emerald-700">{getItemName(log.itemId)}</span><span className="text-xs text-gray-500">{log.org} | {log.qty}개</span></div><button onClick={() => handleDeleteEntry(selectedDate, log.id)} className="text-red-400 hover:text-red-600 p-2 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button></div>))}</div>
                ) : ( <div className="text-center text-gray-400 text-sm py-4">아직 기록이 없습니다.</div> )}
              </div>
              <div className="space-y-3 border-t pt-4">
                <h4 className="text-sm font-bold text-gray-700">새 항목 추가</h4>
                
                {(inputError || serverError) && (
                  <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded text-sm font-bold mb-2 flex items-center gap-2 animate-pulse">
                    <AlertTriangle className="w-4 h-4" /> {inputError || serverError}
                  </div>
                )}

                <div><label className="block text-xs font-bold text-gray-500 mb-1">물품 선택</label><div className="relative"><select value={newItemData.itemId} onChange={(e) => setNewItemData({...newItemData, itemId: e.target.value})} className="w-full border border-gray-300 rounded-lg pl-3 pr-8 py-2 appearance-none focus:ring-2 focus:ring-emerald-500 bg-white">{items.filter(item => !item.isDeleted).map(item => (<option key={item.id} value={item.id}>{item.name}</option>))}</select><div className="absolute right-3 top-2.5 pointer-events-none text-gray-500">▼</div></div></div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2 relative">
                    <label className="block text-xs font-bold text-gray-500 mb-1">
                      기관 이름
                      {matchedAgencies.length > 0 && matchIndex >= 0 && (
                        <span className="ml-2 text-xs text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded">
                          💡 Tab: {matchedAgencies[matchIndex]} ({matchIndex + 1}/{matchedAgencies.length})
                        </span>
                      )}
                    </label>
                    
                    {isCapsLockOn && (
                      <span className="absolute right-0 top-0 text-xs bg-red-500 text-white px-2 py-0.5 rounded animate-pulse">
                        ⚠️ Caps Lock 켜짐
                      </span>
                    )}

                    <input 
                      type="text" 
                      placeholder="예: 낭성복지회관" 
                      value={newItemData.org} 
                      onChange={(e) => {
                        checkCapsLock(e.nativeEvent);
                        setInputError('');
                        
                        const converted = engToKor(e.target.value);
                        setNewItemData(prev => ({...prev, org: converted})); 

                        if (converted.length > 0 && agencies.length > 0) {
                          const matches = agencies.filter(agency => agency.includes(converted));
                          if (matches.length > 0) {
                            setMatchedAgencies(matches);
                            setMatchIndex(0); 
                          } else {
                            setMatchedAgencies([]);
                            setMatchIndex(-1);
                          }
                        } else {
                          setMatchedAgencies([]);
                          setMatchIndex(-1);
                        }
                      }} 
                      onKeyDown={handleKeyDown} 
                      onClick={(e) => checkCapsLock(e.nativeEvent)} 
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500" 
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">수량</label>
                    <input type="number" placeholder="0" value={newItemData.qty} onChange={(e) => { setInputError(''); setNewItemData(prev => ({...prev, qty: e.target.value})); }} onKeyDown={handleKeyDown} className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500" />
                  </div>
                </div>
                <button onClick={handleAddItem} className="w-full bg-emerald-600 text-white font-bold py-3 rounded-lg hover:bg-emerald-700 flex justify-center items-center gap-2 mt-2"><Save className="w-4 h-4" /> 입력하기</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[120] p-4 no-print animate-in fade-in duration-200">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full transform scale-100">
            <div className="flex items-center gap-3 mb-4 text-red-600"><AlertTriangle className="w-6 h-6" /><h3 className="font-bold text-lg">확인 필요</h3></div>
            <p className="text-gray-600 mb-6">{confirmModal.message}</p>
            {serverError && <p className="text-red-700 mb-4">{serverError}</p>}
            <div className="flex justify-end gap-3"><button onClick={() => setConfirmModal({ ...confirmModal, isOpen: false })} className="px-4 py-2 rounded-lg bg-gray-200 text-gray-700 font-bold hover:bg-gray-300">취소</button><button onClick={confirmModal.onConfirm} className="px-4 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700">확인</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
