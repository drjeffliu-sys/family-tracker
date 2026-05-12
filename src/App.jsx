import { useState, useRef, useCallback, useEffect } from "react";

const API_URL = "https://script.google.com/macros/s/AKfycby1lsL2QkRa8oENRWnOpjZNFOp7UxEBsF83uSTHMIhDcA4_QCvHSBR4gBaOBWLXgFpV/exec";

const CATS = [
  { name: "住房", color: "#4361EE", icon: "🏠" },
  { name: "食物", color: "#06B6A4", icon: "🛒" },
  { name: "交通", color: "#F59E0B", icon: "🚗" },
  { name: "醫療", color: "#EC4899", icon: "💊" },
  { name: "小孩", color: "#8B5CF6", icon: "👶" },
  { name: "娛樂", color: "#F97316", icon: "🎉" },
  { name: "衣物", color: "#10B981", icon: "👕" },
  { name: "其他", color: "#94A3B8", icon: "📦" },
];
const WHO_LIST = ["Jeff", "老婆"];
const DEFAULT_BUDGETS = { 住房: 2000, 食物: 1200, 交通: 400, 醫療: 200, 小孩: 600, 娛樂: 300, 衣物: 200, 其他: 200 };
const LS_BUDGETS = "ott_budgets_v3";

const todayStr = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`; };
const fmtCAD = (n) => "$" + Number(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const catOf = (name) => CATS.find(c => c.name === name) ?? CATS[CATS.length - 1];
const loadLS = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } };
const saveLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

async function apiGet() {
  const res = await fetch(API_URL + "?t=" + Date.now(), { redirect: "follow" });
  const json = await res.json();
  if (!json.ok) throw new Error("讀取失敗");
  return (json.data || []).map(row => ({
    ...row,
    amount: parseFloat(row.amount) || 0,
    id: String(row.id),
  }));
}

async function apiAdd(entry) {
  const form = new FormData();
  form.append("payload", JSON.stringify({ action: "add", ...entry }));
  await fetch(API_URL, { method: "POST", body: form, redirect: "follow", mode: "no-cors" });
}

async function apiDelete(id) {
  const form = new FormData();
  form.append("payload", JSON.stringify({ action: "delete", id }));
  await fetch(API_URL, { method: "POST", body: form, redirect: "follow", mode: "no-cors" });
}

async function scanReceipt(base64, mediaType) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: `你是收據辨識助手。從這張收據圖片提取資訊，只回傳 JSON，不加任何解釋或 markdown：\n{"amount":<CAD數字或null>,"date":"<YYYY-MM-DD，若無填${todayStr()}>","note":"<商店名或主要品項，最多20字>","cat":"<住房|食物|交通|醫療|小孩|娛樂|衣物|其他>"}` }
        ]
      }]
    })
  });
  if (!res.ok) throw new Error("API 失敗");
  const data = await res.json();
  const text = data.content?.find(b => b.type === "text")?.text ?? "";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

function Donut({ data, colors, size = 144 }) {
  const total = data.reduce((s, v) => s + v, 0);
  if (!total) return <div style={{ textAlign: "center", color: "#94A3B8", fontSize: 12, padding: "24px 0" }}>本月尚無支出</div>;
  const r = 50, cx = size/2, cy = size/2, circ = 2*Math.PI*r;
  let cum = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {data.map((v, i) => {
        if (!v) return null;
        const dash = (v/total)*circ, offset = circ*(1-cum);
        cum += v/total;
        return <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={colors[i]} strokeWidth={20}
          strokeDasharray={`${dash} ${circ-dash}`} strokeDashoffset={offset}
          style={{ transform:`rotate(-90deg)`, transformOrigin:`${cx}px ${cy}px` }} />;
      })}
      <text x={cx} y={cy-7} textAnchor="middle" fontSize="10" fill="#94A3B8">總計</text>
      <text x={cx} y={cy+12} textAnchor="middle" fontSize="16" fontWeight="700" fill="#0F172A">${Math.round(total)}</text>
    </svg>
  );
}

function Bars({ entries }) {
  const me = entries.filter(e => e.date?.startsWith(thisMonth()));
  const days = {};
  me.forEach(e => { const d = e.date.slice(8); days[d] = (days[d]||0)+e.amount; });
  const labels = Object.keys(days).sort().slice(-14);
  if (!labels.length) return <div style={{ color:"#94A3B8", fontSize:12, textAlign:"center", padding:12 }}>本月尚無記錄</div>;
  const maxV = Math.max(...labels.map(d => days[d]));
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:3, height:68 }}>
      {labels.map(d => (
        <div key={d} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
          <div style={{ width:"100%", background:"#4361EE", borderRadius:"2px 2px 0 0",
            height:Math.round((days[d]/maxV)*54)+"px", minHeight:3 }} />
          <div style={{ fontSize:8, color:"#94A3B8" }}>{d}</div>
        </div>
      ))}
    </div>
  );
}

function SyncBadge({ status }) {
  const map = {
    idle:    { color:"#94A3B8", bg:"#F8FAFC", border:"#E2E8F0", text:"已同步" },
    loading: { color:"#F59E0B", bg:"#FFFBEB", border:"#FDE68A", text:"同步中…" },
    error:   { color:"#EF4444", bg:"#FEF2F2", border:"#FECACA", text:"同步失敗" },
    saving:  { color:"#4361EE", bg:"#EEF2FF", border:"#C7D2FE", text:"儲存中…" },
  };
  const s = map[status] || map.idle;
  return (
    <div style={{ fontSize:10, fontWeight:600, padding:"3px 10px", borderRadius:20,
      color:s.color, background:s.bg, border:`1px solid ${s.border}` }}>
      {s.text}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("record");
  const [entries, setEntries] = useState([]);
  const [budgets, setBudgets] = useState(() => loadLS(LS_BUDGETS, DEFAULT_BUDGETS));
  const [syncStatus, setSyncStatus] = useState("loading");
  const [who, setWho] = useState("Jeff");
  const [selCat, setSelCat] = useState("食物");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayStr());
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState("");
  const fileRef = useRef();
  const [toast, setToast] = useState("");
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2200); };

  useEffect(() => { fetchEntries(); }, []);

  async function fetchEntries() {
    setSyncStatus("loading");
    try {
      const data = await apiGet();
      setEntries(data);
      setSyncStatus("idle");
    } catch {
      setSyncStatus("error");
      showToast("無法連線，請檢查網路");
    }
  }

  async function addEntry() {
    if (!note.trim() || !amount || !date) { showToast("請填寫說明、金額、日期"); return; }
    const entry = { id: String(Date.now()), note: note.trim(), amount: parseFloat(amount), date, cat: selCat, who };
    setEntries(prev => [entry, ...prev]);
    setNote(""); setAmount(""); setDate(todayStr()); setScanResult(null);
    setSyncStatus("saving");
    try {
      await apiAdd(entry);
      setSyncStatus("idle");
      showToast("已儲存到 Google Sheet ✓");
    } catch {
      setSyncStatus("error");
      showToast("儲存失敗，請重試");
      setEntries(prev => prev.filter(e => e.id !== entry.id));
    }
  }

  async function delEntry(id) {
    setEntries(prev => prev.filter(e => e.id !== id));
    setSyncStatus("saving");
    try {
      await apiDelete(id);
      setSyncStatus("idle");
    } catch {
      setSyncStatus("error");
      showToast("刪除失敗");
    }
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target.result;
      setScanning(true); setScanResult(null); setScanError("");
      try {
        const result = await scanReceipt(dataUrl.split(",")[1], file.type || "image/jpeg");
        setScanResult({ ...result, imageUrl: dataUrl });
        if (result.note) setNote(result.note);
        if (result.amount) setAmount(String(result.amount));
        if (result.date) setDate(result.date);
        if (result.cat && CATS.find(c => c.name === result.cat)) setSelCat(result.cat);
        showToast("辨識完成，請確認後新增");
      } catch { setScanError("辨識失敗，請手動填寫"); }
      finally { setScanning(false); e.target.value = ""; }
    };
    reader.readAsDataURL(file);
  }

  function exportCSV() {
    if (!monthEntries.length) { showToast("本月沒有記錄"); return; }
    const rows = [["日期","說明","類別","記帳人","金額CAD"],
      ...monthEntries.map(e => [e.date, e.note, e.cat, e.who, e.amount.toFixed(2)])];
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8,\uFEFF" + encodeURIComponent(rows.map(r=>r.join(",")).join("\n"));
    a.download = `家庭記帳_${thisMonth()}.csv`;
    a.click();
    showToast("CSV 匯出成功");
  }

  const monthEntries = entries.filter(e => e.date?.startsWith(thisMonth()));
  const totalSpent = monthEntries.reduce((s,e) => s+e.amount, 0);
  const totalBudget = Object.values(budgets).reduce((s,v) => s+Number(v), 0);
  const remain = totalBudget - totalSpent;
  const pct = totalBudget ? Math.min(100, Math.round((totalSpent/totalBudget)*100)) : 0;
  const catTotals = CATS.map(
