import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Calendar, Package, Plus, Trash2, Save, X, ChevronLeft, ChevronRight, Printer, Download, Upload, FileJson, AlertTriangle, BarChart3, FileText, FileType, Search, ArrowUp, ArrowDown, CheckCircle, FolderOpen, Building, FileUp, FileDown, RefreshCw } from 'lucide-react';
import { engToKor } from './hangeul.js'; 

const inventoryUrl = '/api/v1/inventory';
const sqliteUrl = `${inventoryUrl}/sqlite`;
const navigation = [
  { id: 'calendar', label: '달력 대장', icon: Calendar },
  { id: 'report', label: '월별 보고서', icon: FileText },
  { id: 'stats', label: '연간 통계', icon: BarChart3 },
  { id: 'items', label: '품목 관리', icon: Package },
  { id: 'agencies', label: '기관 관리', icon: Building },
  { id: 'data', label: '데이터 관리', icon: Save },
];
const nextId = (records) => records.reduce((next, record) => Math.max(next, record.id + 1), Date.now());
const viewKey = 'green-village-inventory:view';

function loadView() {
  let saved;
  try {
    saved = JSON.parse(window.localStorage.getItem(viewKey));
  } catch {
    // The app also works when browser storage is unavailable.
  }
  const date = new Date(saved?.currentDate ?? NaN);
  return {
    activeTab: navigation.some(({ id }) => id === saved?.activeTab) ? saved.activeTab : 'calendar',
    currentDate: Number.isNaN(date.getTime()) ? new Date() : date,
    selectedOrg: typeof saved?.selectedOrg === 'string' ? saved.selectedOrg : 'ALL',
  };
}
const uncategorized = { id: 0, name: '미분류' };
const categoryOf = (item) => item.categoryId ?? uncategorized.id;
const selectClass = 'w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500';
const agencyKey = (name) => name.replace(/\s+/g, '');

function indexAgencies(agencies, logs) {
  const index = new Map();
  for (const name of agencies) {
    const key = agencyKey(name);
    if (key && !index.has(key)) index.set(key, { name, hasHistory: false });
  }
  for (const date of Object.keys(logs).sort()) {
    for (const { org } of logs[date]) {
      const key = agencyKey(org);
      if (!key) continue;
      const known = index.get(key);
      if (known) known.hasHistory = true;
      else index.set(key, { name: org.trim(), hasHistory: true });
    }
  }
  return index;
}

async function inventoryRequest(options, url = inventoryUrl) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(result.error || '서버 요청에 실패했습니다.'), { status: response.status });
  }
  return result;
}

export default function App() {
  const [view, setView] = useState(loadView);
  const { activeTab, currentDate, selectedOrg } = view;
  const setActiveTab = (value) => setView((current) => ({ ...current, activeTab: value }));
  const setCurrentDate = (value) => setView((current) => ({ ...current, currentDate: value }));
  const setSelectedOrg = (value) => setView((current) => ({ ...current, selectedOrg: value }));

  useEffect(() => {
    try {
      window.localStorage.setItem(viewKey, JSON.stringify(view));
    } catch {
      // Keep navigation usable if the browser blocks storage.
    }
  }, [view]);
  const [saveStatus, setSaveStatus] = useState(''); 
  const [serverError, setServerError] = useState('');
  const snapshot = useRef(null);
  const saving = useRef(false);
  const electron = window.electron;

  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [logs, setLogs] = useState({});
  const [agencies, setAgencies] = useState([]);
  const agencyIndex = useMemo(() => indexAgencies(agencies, logs), [agencies, logs]);
  const agencyName = (name) => agencyIndex.get(agencyKey(name))?.name ?? name;

  const [matchedAgencies, setMatchedAgencies] = useState([]); 
  const [matchIndex, setMatchIndex] = useState(-1); 

  const [isCapsLockOn, setIsCapsLockOn] = useState(false);
  const [inputError, setInputError] = useState('');
  
  const [newItemData, setNewItemData] = useState({ categoryId: '', itemId: '', org: '', qty: '' });
  const agencyInput = useRef(null);
  const [newAgencyName, setNewAgencyName] = useState('');
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState(uncategorized.id);
  const createItemCategory = categories.some(({ id }) => id === newItemCategory) ? newItemCategory : uncategorized.id;
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, message: '', onConfirm: null });

  const showData = useCallback((data) => {
    setItems(data.items || []);
    setCategories(data.categories || []);
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
          if (data.categories && !base.data.categories) {
            throw new Error('대분류를 사용하려면 서버를 업데이트하고 다시 시작하세요.');
          }
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
        setConfirmModal({ isOpen: false, message: '', onConfirm: null });
        if (confirmModal.isOpen) {
          if (confirmModal.confirmOnEnter) agencyInput.current?.focus();
          return;
        }
        setIsModalOpen(false);
        setInputError('');
        setMatchedAgencies([]);
        setMatchIndex(-1);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [confirmModal.isOpen, confirmModal.confirmOnEnter]);

  const [selectedDate, setSelectedDate] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

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
  const getYearlyOrgStats = () => {
    const allOrgs = new Set();
    const groups = new Map();
    let totalCount = 0;
    for (const dateKey of Object.keys(logs).sort()) {
      const [year, month, day] = dateKey.split('-').map(Number);
      if (year !== currentDate.getFullYear()) continue;
      for (const log of logs[dateKey]) {
        const name = agencyName(log.org);
        allOrgs.add(name);
        if (selectedOrg !== 'ALL' && agencyKey(selectedOrg) !== agencyKey(name)) continue;
        if (!groups.has(name)) groups.set(name, { logs: [], totalQty: 0 });
        const group = groups.get(name);
        group.logs.push({ ...log, dateKey, month, day });
        group.totalQty += log.qty;
        totalCount += 1;
      }
    }
    return {
      allOrgs: [...allOrgs].sort(),
      sortedGroupedData: [...groups].sort(([, a], [, b]) => b.totalQty - a.totalQty),
      totalCount,
    };
  };
  const handleExportWord = () => { /* ...기존과 완전 동일... */ };

  const handleDayClick = (date) => {
    if (!date) return;
    setSelectedDate(formatDateKey(date));
    setIsModalOpen(true);
    setInputError('');
    setMatchedAgencies([]);
    setMatchIndex(-1);
    const firstValidItem = items.find(i => !i.isDeleted);
    setNewItemData({
      categoryId: categories.length ? '' : uncategorized.id,
      itemId: categories.length ? '' : firstValidItem?.id || '',
      org: '',
      qty: '',
    });
  };

  // 🔥 [수정] 달력 기록 추가 시 (Safe Save 적용)
  const handleAddItem = () => {
    if (!newItemData.itemId) { setInputError("물품을 선택해주세요."); return; }
    if (!newItemData.qty || Number(newItemData.qty) <= 0) { setInputError("수량은 1개 이상 입력해야 합니다!"); return; }
    setInputError('');
    const typedName = newItemData.org.trim();
    const known = agencyIndex.get(agencyKey(typedName));
    if (known && !known.hasHistory && known.name !== typedName) {
      setConfirmModal({
        isOpen: true,
        message: `“${known.name}”을(를) 입력하셨나요?`,
        confirmOnEnter: true,
        onConfirm: () => {
          setConfirmModal({ isOpen: false, message: '', onConfirm: null });
          agencyInput.current?.focus();
          saveEntry(known.name);
        },
      });
      return;
    }
    saveEntry(known?.name ?? typedName);
  };

  const saveEntry = async (org) => {
    const saved = await safeSave((latestData) => {
      const itemId = Number(newItemData.itemId);
      if (!latestData.items.some((item) => item.id === itemId && !item.isDeleted
          && categoryOf(item) === newItemData.categoryId)) {
        throw new Error('목록에 있는 물품을 다시 선택하세요.');
      }
      const currentLogs = latestData.logs || {};
      const entries = currentLogs[selectedDate] || [];
      const newEntry = { id: nextId(entries), itemId, org, qty: Number(newItemData.qty) };
      return {
        ...latestData,
        logs: { ...currentLogs, [selectedDate]: [...entries, newEntry] }
      };
    });
    if (!saved) return;

    const firstValidItem = items.find(i => !i.isDeleted);
    setNewItemData((current) => current === newItemData
      ? { ...current, itemId: categories.length ? '' : firstValidItem?.id || '', org: '', qty: '' }
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
      if (e.repeat || e.nativeEvent?.isComposing) return;
      e.preventDefault();
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
      if (names.some((existing) => agencyKey(existing) === agencyKey(name))) {
        throw new Error('이미 등록된 기관입니다.');
      }
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
      const uniqueLines = [...indexAgencies(lines, {}).values()].map(({ name }) => name);
      
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
      const categoryId = categoryOf(newItems[index]);
      while (newItems[target] && (newItems[target].isDeleted || categoryOf(newItems[target]) !== categoryId)) {
        target += step;
      }
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
      if (createItemCategory && !latestData.categories?.some((category) => category.id === createItemCategory)) {
        throw new Error('대분류를 다시 선택하세요.');
      }
      const item = { id: nextId(items), name: newItemName, isDeleted: false, categoryId: createItemCategory || null };
      return { ...latestData, items: [...items, item] };
    });
    if (saved) setNewItemName((current) => current === newItemName ? '' : current);
  };

  const handleCreateCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    const saved = await safeSave((data) => {
      const existing = data.categories || [];
      if (name === uncategorized.name || existing.some((category) => category.name === name)) {
        throw new Error('이미 사용하는 대분류 이름입니다.');
      }
      return { ...data, categories: [...existing, { id: nextId(existing), name }] };
    });
    if (saved) setNewCategoryName((current) => current === newCategoryName ? '' : current);
  };

  const handleAssignCategory = (itemId, categoryId) => {
    safeSave((data) => ({
      ...data,
      items: data.items.map((item) => item.id === itemId
        ? { ...item, categoryId: categoryId || null }
        : item),
    }));
  };

  const handleDeleteCategory = (category) => {
    const revision = snapshot.current?.revision;
    const remove = async (deleteItems) => {
      const saved = await safeSave((data) => ({
        ...data,
        categories: data.categories.filter(({ id }) => id !== category.id),
        items: data.items.map((item) => categoryOf(item) === category.id
          ? { ...item, categoryId: null, isDeleted: deleteItems || item.isDeleted }
          : item),
      }), revision);
      if (saved) setNewItemCategory((current) => current === category.id ? uncategorized.id : current);
      setConfirmModal({ isOpen: false, message: '', onConfirm: null });
    };
    setConfirmModal({
      isOpen: true,
      message: `“${category.name}” 대분류를 삭제합니다. 품목을 남기면 미분류로 이동합니다. 품목도 삭제하면 선택 목록에서 사라지고, 기존 대장 기록은 유지됩니다.`,
      alternateAction: { label: '품목은 남기기', onClick: () => remove(false) },
      confirmLabel: '품목도 삭제',
      onConfirm: () => remove(true),
    });
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
              const saved = await safeSave(() => ({ ...data, agencies: data.agencies || [], categories: data.categories || [] }), revision);
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
    const data = { logs, items, agencies, categories, exportDate: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `물품대장_백업_${new Date().toISOString().slice(0,10)}.json`; document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const downloadStocktake = () => {
    const escapeRtf = (text) => text.split('').map((char) => {
      const code = char.charCodeAt(0);
      if (code < 32) return ' ';
      if (code > 126) return `\\u${code > 32767 ? code - 65536 : code}?`;
      return '\\{}'.includes(char) ? `\\${char}` : char;
    }).join('');
    const row = (cells) => {
      const borders = '\\clbrdrt\\brdrs\\clbrdrl\\brdrs\\clbrdrb\\brdrs\\clbrdrr\\brdrs';
      const layout = [750, 5400, 6900, 9500].map((edge) => `${borders}\\cellx${edge}`).join('');
      return `\\trowd\\trgaph100\\trrh380${layout}\n\\intbl ${cells.map(escapeRtf).join('\\cell ')}\\cell\\row\n`;
    };
    const rows = items.filter((item) => !item.isDeleted)
      .map((item, index) => row([String(index + 1), item.name, '', '']));
    const content = `{\\rtf1\\ansi\\uc1\\paperw11906\\paperh16838\\margl1100\\margr1100{\\fonttbl{\\f0 Malgun Gothic;}}\\f0\\fs22\n`
      + `\\b\\fs32 ${escapeRtf('재고조사표')}\\b0\\fs22\\par\n`
      + `${escapeRtf('조사일: __________________    조사자: __________________')}\\par\\par\n`
      + row(['번호', '품목명', '실사 수량', '비고']) + rows.join('') + '}';
    const url = URL.createObjectURL(new Blob([content], { type: 'application/rtf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = '재고조사표.rtf';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const categoryGroups = [...categories, uncategorized];
  const groupedItems = new Map(categoryGroups.map(({ id }) => [id, []]));
  for (const item of items) {
    if (!item.isDeleted) groupedItems.get(categoryOf(item))?.push(item);
  }
  const categoryOptions = categoryGroups.map(({ id, name }) => <option key={id} value={id}>{name}</option>);
  const recordItems = groupedItems.get(newItemData.categoryId) || [];
  const selectedRecordItem = recordItems.some(({ id }) => id === newItemData.itemId) ? newItemData.itemId : '';

  return (
    <div className="min-h-dvh bg-gray-50 text-slate-800 font-sans print:bg-white print:min-h-0"
      onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}
    >
        {isDragging && (
          <div className="fixed inset-0 z-[100] bg-emerald-600/90 flex flex-col items-center justify-center text-white backdrop-blur-sm transition-all duration-300 pointer-events-none no-print">
            <Upload className="w-20 h-20 mb-4 animate-bounce" />
            <h2 className="text-3xl font-bold">파일을 여기에 놓으세요</h2>
            <p className="mt-2 text-emerald-100">데이터가 자동으로 로드됩니다</p>
          </div>
        )}

        <style>{`@media print { @page { size: A4; margin: 15mm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .no-print { display: none !important; } .print-full { height: auto !important; overflow: visible !important; width: 100% !important; } .print-text-black { color: black !important; } .print-border-black { border-color: black !important; } .break-inside-avoid { break-inside: avoid; } }`}</style>

        {/* Header */}
        <header className="w-full bg-emerald-600 text-white px-3 py-3 sm:p-4 lg:px-6 shadow-md flex flex-wrap justify-between items-center gap-x-6 gap-y-3 no-print">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="text-base sm:text-xl font-bold flex items-center gap-2">
              <Calendar className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" />
              녹색마을만들기 물품 대장
            </h1>
            {saveStatus && (
              <span className="text-xs bg-emerald-800 text-emerald-100 px-2 py-1 rounded animate-pulse flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> {saveStatus}
              </span>
            )}
            {serverError && <span role="alert" className="text-xs bg-red-800 px-2 py-1 rounded">{serverError}</span>}
            <button onClick={handlePrint} className="px-2 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold bg-emerald-700 text-emerald-100 hover:bg-emerald-500 flex items-center gap-1 sm:gap-2">
              <Printer className="w-4 h-4" /> 인쇄
            </button>
            {activeTab === 'report' && (
              <button onClick={handleExportWord} className="px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-500 flex items-center gap-2">
                <FileType className="w-4 h-4" /> Word 저장
              </button>
            )}
          </div>
          <nav aria-label="주 메뉴" className="grid w-full grid-cols-3 gap-1.5 sm:flex sm:w-auto sm:flex-wrap sm:gap-2">
            {navigation.map(({ id, label, icon }) => (
              <button key={id} type="button" aria-pressed={activeTab === id} onClick={() => setActiveTab(id)}
                className={`flex min-h-10 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-1 py-2 text-xs font-bold transition-colors sm:px-3 sm:text-sm ${activeTab === id ? 'bg-white text-emerald-700' : 'bg-emerald-700 text-emerald-100 hover:bg-emerald-500'}`}>
                {React.createElement(icon, { 'aria-hidden': true, className: 'w-4 h-4 shrink-0' })} {label}
              </button>
            ))}
          </nav>
        </header>

        <div className="px-2 py-4 sm:px-4 md:px-6 print:p-0">
        <main className={`flex min-w-0 flex-col rounded-lg bg-white shadow-md p-2 sm:p-4 md:p-6 print:h-auto print:p-0 print:shadow-none ${activeTab === 'calendar' ? 'mx-auto max-w-7xl lg:h-[calc(100dvh-132px)] lg:min-h-[37rem] print:min-h-0 print:max-w-none' : ''}`}>
          {activeTab !== 'data' && activeTab !== 'agencies' && (
            <div className="p-2 sm:p-4 flex flex-wrap justify-between items-center gap-2 bg-white rounded-t-xl border-b border-gray-200 no-print shrink-0">
              <div className="flex flex-wrap items-center gap-1 sm:gap-4">
                <button aria-label="이전 달" onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))} className="p-1 hover:bg-gray-100 rounded-full"><ChevronLeft /></button>
                <h2 className="text-lg sm:text-2xl font-bold text-gray-800">{currentDate.getFullYear()}년 {activeTab === 'stats' ? '' : `${currentDate.getMonth() + 1}월`}</h2>
                <button aria-label="다음 달" onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))} className="p-1 hover:bg-gray-100 rounded-full"><ChevronRight /></button>
                <button onClick={() => setCurrentDate(new Date())} className="sm:ml-2 text-xs bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full font-bold hover:bg-emerald-200 transition-colors">{activeTab === 'stats' ? '올해' : '이번 달'}</button>
              </div>
              <div className="text-sm text-gray-500">
                {activeTab === 'calendar' ? '* 날짜를 클릭하여 기록 / 상단 [인쇄] 버튼으로 출력' : activeTab === 'report' ? '* 우측 상단 [Word 저장]을 눌러 편집 가능한 파일로 저장하세요.' : activeTab === 'stats' ? '* 연간 전체 기록을 기관별로 조회하고 인쇄합니다.' : ''}
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1">
            {activeTab === 'calendar' && (
              <div className="lg:h-full flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 print:border-none print:shadow-none print:h-auto">
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
                <div className="grid grid-cols-7 flex-1 auto-rows-fr lg:overflow-y-auto bg-gray-200 gap-px border border-gray-200 print:bg-black print:border-black print:gap-[1px] print:overflow-visible print:h-auto">
                  {getDaysInMonth(currentDate).map((date, idx) => {
                    const dateKey = formatDateKey(date);
                    const dayLogs = dateKey ? logs[dateKey] : [];
                    const isToday = isSameDay(date, today);
                    return (
                      <div key={idx} onClick={() => handleDayClick(date)} className={`bg-white min-h-16 sm:min-h-[100px] p-0.5 sm:p-2 flex flex-col gap-1 transition-colors hover:bg-emerald-50 cursor-pointer ${!date ? 'bg-gray-50 print:bg-white' : ''} ${isToday ? 'bg-blue-50/50 print:bg-white' : ''} print:min-h-[120px] print:p-2 print:block relative overflow-hidden group`}>
                        {date && (
                          <>
                            <div className="flex justify-between items-start shrink-0">
                              <span className={`text-sm font-bold flex items-center justify-center w-7 h-7 print:text-black ${isToday ? 'bg-blue-600 text-white rounded-full shadow-md print:bg-transparent print:border print:border-black print:text-black' : date.getDay() === 0 ? 'text-red-500' : date.getDay() === 6 ? 'text-blue-500' : 'text-gray-700'}`}>{date.getDate()}</span>
                            </div>
                            {dayLogs?.length > 0 && <span className="self-center rounded bg-emerald-100 px-0.5 text-[10px] font-bold text-emerald-800 sm:hidden print:hidden">{dayLogs.length}건</span>}
                            <div className="hidden sm:grid grid-cols-1 lg:grid-cols-2 gap-1 mt-1 overflow-y-auto max-h-[140px] pr-1 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent print:max-h-none print:overflow-visible print:block">
                              {dayLogs && dayLogs.map((log) => (
                                <div key={log.id} className="text-xs bg-emerald-100 text-emerald-800 p-1 rounded border border-emerald-200 print:bg-white print:border-none print:text-black print:p-0 print:mb-1">
                                  <div className="flex flex-col print:block">
                                    <span className="font-bold whitespace-normal break-words leading-tight">[{getItemName(log.itemId)}]</span>
                                    <span className="print:hidden h-px bg-emerald-200 my-0.5"></span>
                                    <span className="whitespace-normal break-words leading-tight text-[11px]">{agencyName(log.org)} ({log.qty}개)</span>
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
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 sm:p-6 lg:p-8 print:p-0 print:border-none print:shadow-none print:w-full">
                <div className="text-center mb-6 sm:mb-10 pb-4 border-b-2 border-gray-800 print:mb-6"><h1 className="text-xl sm:text-3xl font-bold text-gray-900 print:text-black">{currentDate.getFullYear()}년 {currentDate.getMonth() + 1}월 물품 수불 대장</h1></div>
                {Object.keys(reportData).length > 0 ? (
                  <div className="space-y-8 print:space-y-6">
                    {Object.values(reportData).map(data => (
                      <div key={data.name} className="break-inside-avoid">
                         <div className="flex flex-wrap justify-between items-center gap-2 mb-2 px-2 border-l-4 border-gray-800 bg-gray-100 py-2 print:bg-gray-50 print:border-black"><h3 className="min-w-0 break-words text-lg font-bold text-gray-800 print:text-black">{data.name}</h3><span className="font-bold text-emerald-700 print:text-black">총 {data.totalQty}개 출고</span></div>
                          <table className="w-full table-fixed break-words text-sm text-left border-collapse border border-gray-300 print:border-black">
                          <thead className="bg-gray-50 print:bg-gray-100"><tr><th className="py-2 pl-4 w-1/5 border-b border-r border-gray-300 print:border-black">일자</th><th className="py-2 pl-4 w-3/5 border-b border-r border-gray-300 print:border-black">제공 기관 (사용처)</th><th className="py-2 pr-4 text-right w-1/5 border-b border-gray-300 print:border-black">수량</th></tr></thead>
                          <tbody>
                            {data.logs.map(log => (
                              <tr key={log.id} className="border-b border-gray-200 hover:bg-gray-50 print:border-black"><td className="py-2 pl-4 border-r border-gray-200 print:border-black text-gray-700 print:text-black">{currentDate.getMonth() + 1}월 {log.day}일</td><td className="py-2 pl-4 border-r border-gray-200 print:border-black font-medium text-gray-900 print:text-black">{agencyName(log.org)}</td><td className="py-2 pr-4 text-right text-gray-900 print:text-black">{log.qty}</td></tr>
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
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col print:border-none print:shadow-none print:w-full print:block">
                <div className="px-3 pt-3 sm:px-6 sm:pt-6 print:hidden">
                  <div className="flex flex-col md:flex-row gap-4 items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex items-center gap-3 w-full md:w-auto"><Search className="w-5 h-5 text-gray-400" /><span className="font-bold text-gray-700 whitespace-nowrap">기관 선택:</span>
                       <select value={selectedOrg} onChange={(e) => setSelectedOrg(e.target.value)} className="w-full min-w-0 md:w-64 border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
                         <option value="ALL">전체 기관 (많이 가져간 순)</option>{yearlyStats.allOrgs.map(org => (<option key={org} value={org}>{org}</option>))}
                       </select>
                    </div>
                    <div className="text-sm text-gray-500">총 <strong className="text-emerald-600">{yearlyStats.totalCount}건</strong>의 기록이 조회되었습니다.</div>
                  </div>
                </div>
                <div className="p-3 sm:p-6 print:p-0">
                  <div className="text-center mb-6 sm:mb-10 pb-4 border-b-2 border-gray-800 print:mb-6"><h1 className="text-xl sm:text-3xl font-bold text-gray-900 print:text-black">{currentDate.getFullYear()}년도 기관별 물품 수불 통계</h1><p className="text-gray-500 mt-2 break-words print:text-black">조회 기준: {selectedOrg === 'ALL' ? '전체 기관 (수령량 내림차순)' : selectedOrg}</p></div>
                  {yearlyStats.sortedGroupedData.length > 0 ? (
                    <div className="space-y-8 print:space-y-6 pb-10">
                      {yearlyStats.sortedGroupedData.map(([orgName, data]) => (
                        <div key={orgName} className="break-inside-avoid shadow-sm border border-gray-200 rounded-lg overflow-hidden print:shadow-none print:border-none print:rounded-none">
                          <div className="flex flex-wrap justify-between items-center gap-2 px-3 sm:px-4 py-3 bg-emerald-50 border-b border-emerald-100 print:bg-gray-100 print:border-black print:border-b-2"><h3 className="min-w-0 break-words text-base sm:text-xl font-bold text-gray-900 print:text-black">{orgName}<span className="ml-2 inline-block text-xs font-normal text-gray-500 bg-white px-2 py-0.5 rounded-full border border-gray-200 print:hidden">{data.logs.length}건 기록</span></h3><span className="text-sm sm:text-lg font-bold text-emerald-700 print:text-black">총 {data.totalQty}개 수령</span></div>
                          <table className="w-full table-fixed break-words text-sm text-left border-collapse print:border-black">
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
              <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-3 sm:p-6 no-print">
                <h2 className="text-lg font-bold mb-4 flex items-center gap-2 shrink-0"><Package className="w-5 h-5 text-emerald-600" />물품 목록 관리</h2>
                <div className="mb-6 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); handleCreateCategory(); }}>
                    <input aria-label="새 대분류 이름" placeholder="새 대분류 이름" value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)} className={`${selectClass} flex-1`} />
                    <button type="submit" className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700">
                      대분류 생성
                    </button>
                  </form>
                  <form className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)_auto]"
                    onSubmit={(e) => { e.preventDefault(); handleCreateItem(); }}>
                    <input aria-label="새 물품명" value={newItemName} onChange={(e) => setNewItemName(e.target.value)}
                      placeholder="새 물품명 입력" className={`${selectClass} col-span-2 sm:col-span-1`} />
                    <select aria-label="새 물품의 대분류" className={selectClass}
                      value={createItemCategory}
                      onChange={(e) => setNewItemCategory(Number(e.target.value))}>{categoryOptions}</select>
                    <button type="submit" className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700">
                      품목 추가
                    </button>
                  </form>
                </div>
                <p className="mb-3 text-xs text-gray-600">품목 옆 목록에서 대분류를 바꾸고, 화살표로 같은 분류 안의 순서를 조정할 수 있습니다.</p>
                <div className="space-y-4">
                  {categoryGroups.map((category) => (
                    <section key={category.id} aria-labelledby={`category-${category.id}`} className="rounded-lg border border-gray-200">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-lg bg-gray-50 px-3 py-2">
                        <h3 id={`category-${category.id}`} className="min-w-0 break-words font-bold text-gray-800">
                          {category.name} <span className="text-xs font-normal text-gray-500">{groupedItems.get(category.id).length}개</span>
                        </h3>
                        {category.id !== uncategorized.id && (
                          <button type="button" onClick={() => handleDeleteCategory(category)} className="rounded px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50">
                            대분류 삭제
                          </button>
                        )}
                      </div>
                      <ul className="divide-y divide-gray-100">
                        {groupedItems.get(category.id).map((item) => (
                          <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)_auto]">
                            <span className="col-span-2 min-w-0 break-words font-medium text-gray-700 sm:col-span-1">{item.name}</span>
                            <select aria-label={`${item.name} 대분류`} value={categoryOf(item)} className={selectClass}
                              onChange={(e) => handleAssignCategory(item.id, Number(e.target.value))}>{categoryOptions}</select>
                            <div className="flex items-center gap-1">
                              <button onClick={() => handleMoveItem(item.id, 'up')} className="rounded p-2 text-gray-500 hover:bg-emerald-50" title="위로 이동"><ArrowUp className="w-4 h-4" /></button>
                              <button onClick={() => handleMoveItem(item.id, 'down')} className="rounded p-2 text-gray-500 hover:bg-emerald-50" title="아래로 이동"><ArrowDown className="w-4 h-4" /></button>
                              <button onClick={() => handleDeleteItem(item.id)} className="rounded p-2 text-red-500 hover:bg-red-50" title="삭제"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          </li>
                        ))}
                      </ul>
                      {groupedItems.get(category.id).length === 0 && <p className="px-3 py-3 text-sm text-gray-500">이 분류에 품목이 없습니다.</p>}
                    </section>
                  ))}
                </div>
              </div>
            )}

            {/* 기관 관리 탭 */}
            {activeTab === 'agencies' && (
              <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-3 sm:p-6 no-print">
                <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
                  <h2 className="text-lg font-bold flex items-center gap-2 shrink-0"><Building className="w-5 h-5 text-emerald-600" />기관 목록 관리</h2>
                  
                  <div className="flex flex-wrap gap-2">
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
                    className="min-w-0 flex-1 border border-gray-300 rounded-lg px-3 sm:px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
                    onKeyPress={(e) => e.key === 'Enter' && handleAddAgency()} 
                  />
                  <button onClick={handleAddAgency} className="shrink-0 bg-emerald-600 text-white px-3 sm:px-6 py-2 rounded-lg font-bold flex items-center gap-2"><Plus className="w-4 h-4" /> 추가</button>
                </div>
                <div className="space-y-2">
                  {agencies.length > 0 ? (
                    agencies.map((agency, index) => (
                      <div key={index} className="flex justify-between items-center p-3 bg-white border border-gray-100 rounded-lg shadow-sm hover:border-emerald-200 transition-colors">
                        <span className="min-w-0 break-words font-medium text-gray-700">{agency}</span>
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
              <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-3 sm:p-6 no-print">
                <h2 className="text-lg font-bold mb-6 flex items-center gap-2"><Save className="w-5 h-5 text-emerald-600" />데이터 저장 및 불러오기</h2>
                <div className="grid gap-6">
                  <button type="button" onClick={downloadStocktake} className="w-fit bg-blue-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2">
                    <FileType className="w-4 h-4" /> 재고조사표 Word 다운로드
                  </button>
                  <div className="p-4 border border-blue-100 bg-blue-50 rounded-lg">
                    <h3 className="font-bold text-blue-800 mb-2 flex items-center gap-2"><RefreshCw className="w-4 h-4" /> 수동 동기화 및 덮어쓰기</h3>
                    {/* 🔥 문구 수정됨 */}
                    <p className="text-sm text-blue-600 mb-4">
                      {electron ? '변경사항은 공유 폴더에 저장됩니다.' : '변경사항은 서버의 SQLite에 저장됩니다.'}
                    </p>
                    <div className="flex flex-wrap gap-2">
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
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-full overflow-y-auto">
            <div className="bg-emerald-600 text-white p-4 flex justify-between items-center"><h3 className="font-bold text-lg flex items-center gap-2"><Calendar className="w-5 h-5" />{selectedDate} 기록</h3><button onClick={() => setIsModalOpen(false)} className="hover:bg-emerald-700 p-1 rounded"><X className="w-5 h-5" /></button></div>
            <div className="p-4 sm:p-6 space-y-4">
              <div className="bg-gray-50 rounded-lg p-3 min-h-[100px] max-h-[150px] overflow-y-auto mb-4 border border-gray-200">
                <h4 className="text-xs font-bold text-gray-500 mb-2 uppercase">등록된 내역</h4>
                {logs[selectedDate]?.length > 0 ? (
                  <div className="space-y-2">{logs[selectedDate].map(log => (<div key={log.id} className="flex justify-between items-center bg-white p-2 rounded border border-gray-200 shadow-sm text-sm"><div className="flex flex-col"><span className="font-bold text-emerald-700">{getItemName(log.itemId)}</span><span className="text-xs text-gray-500">{agencyName(log.org)} | {log.qty}개</span></div><button onClick={() => handleDeleteEntry(selectedDate, log.id)} className="text-red-400 hover:text-red-600 p-2 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button></div>))}</div>
                ) : ( <div className="text-center text-gray-400 text-sm py-4">아직 기록이 없습니다.</div> )}
              </div>
              <div className="space-y-3 border-t pt-4">
                <h4 className="text-sm font-bold text-gray-700">새 항목 추가</h4>
                
                {(inputError || serverError) && (
                  <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded text-sm font-bold mb-2 flex items-center gap-2 animate-pulse">
                    <AlertTriangle className="w-4 h-4" /> {inputError || serverError}
                  </div>
                )}

                <div className={categories.length ? 'grid gap-2 sm:grid-cols-2' : ''}>
                  {categories.length > 0 && (
                    <label className="block min-w-0 text-xs font-bold text-gray-500">
                      대분류
                      <select className={`${selectClass} mt-1 font-normal text-slate-800`}
                        value={groupedItems.has(newItemData.categoryId) ? newItemData.categoryId : ''}
                        onChange={(e) => {
                          setInputError('');
                          setNewItemData((current) => ({ ...current, categoryId: Number(e.target.value), itemId: '' }));
                        }}>
                        <option value="" disabled>대분류 선택</option>
                        {categoryOptions}
                      </select>
                    </label>
                  )}
                  <label className="block min-w-0 text-xs font-bold text-gray-500">
                    물품 선택
                    <select className={`${selectClass} mt-1 font-normal text-slate-800 disabled:bg-gray-100`}
                      value={selectedRecordItem} disabled={recordItems.length === 0}
                      onChange={(e) => {
                        setInputError('');
                        setNewItemData((current) => ({ ...current, itemId: Number(e.target.value) }));
                      }}>
                      <option value="" disabled>{newItemData.categoryId === '' ? '대분류를 먼저 선택하세요' : recordItems.length ? '품목 선택' : '선택할 품목이 없습니다'}</option>
                      {recordItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </label>
                </div>
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
                      ref={agencyInput}
                      type="text" 
                      placeholder="예: 낭성복지회관" 
                      value={newItemData.org} 
                      onChange={(e) => {
                        checkCapsLock(e.nativeEvent);
                        setInputError('');
                        
                        const converted = engToKor(e.target.value);
                        setNewItemData(prev => ({...prev, org: converted})); 

                        const query = agencyKey(converted);
                        if (query) {
                          const matches = [...agencyIndex]
                            .filter(([key]) => key.includes(query))
                            .map(([, { name }]) => name);
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
          <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message"
            className="bg-white rounded-lg shadow-xl p-4 sm:p-6 max-w-sm w-full max-h-full overflow-y-auto transform scale-100">
            <div className="flex items-center gap-3 mb-4 text-red-600"><AlertTriangle className="w-6 h-6" /><h3 id="confirm-title" className="font-bold text-lg">확인 필요</h3></div>
            <p id="confirm-message" className="text-gray-600 mb-6">{confirmModal.message}</p>
            {serverError && <p className="text-red-700 mb-4">{serverError}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button onClick={() => {
                setConfirmModal({ isOpen: false, message: '', onConfirm: null });
                if (confirmModal.confirmOnEnter) agencyInput.current?.focus();
              }} className="px-4 py-2 rounded-lg bg-gray-200 text-gray-700 font-bold hover:bg-gray-300">취소</button>
              {confirmModal.alternateAction && (
                <button onClick={confirmModal.alternateAction.onClick} className="rounded-lg border border-emerald-600 px-3 py-2 font-bold text-emerald-700 hover:bg-emerald-50">
                  {confirmModal.alternateAction.label}
                </button>
              )}
              <button autoFocus={confirmModal.confirmOnEnter} onClick={confirmModal.onConfirm}
                onKeyDown={(event) => { if (event.key === 'Enter' && event.repeat) event.preventDefault(); }}
                className="px-4 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700">{confirmModal.confirmLabel || '확인'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
