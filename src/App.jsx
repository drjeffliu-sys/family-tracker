import { useState, useRef, useCallback, useEffect } from "react";

// ── Config ─────────────────────────────────────────────────────────────────
const API_URL = "https://script.google.com/macros/s/AKfycby1lsL2QkRa8oENRWnOpjZNFOp7UxEBsF83uSTHMIhDcA4_QCvHSBR4gBaOBWLXgFpV/exec";

// ── Constants ──────────────────────────────────────────────────────────────
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

// ── Google Sheets API ──────────────────────────────────────────────────────
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

// ── Receipt scan via Claude API ────────────────────────────────────────────
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
          { type: "text", text: `你是收據辨識助手。從這張收據圖片提取資訊，只回傳 JSON，不加任何解釋或 markdown：
{"amount":<CAD數字或null>,"date":"<YYYY-MM-DD，若無填${todayStr()}>","note":"<商店名或主要品項，最多20字>","cat":"<住房|食物|交通|醫療|小孩|娛樂|衣物|其他>"}` }
        ]
      }]
    })
  });
  if (!res.ok) throw new Error("API 失敗");
  const data = await res.json();
  const text = data.content?.find(b => b.type === "text")?.text ?? "";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// ── Donut Chart ────────────────────────────────────────────────────────────
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

// ── Bar Chart ──────────────────────────────────────────────────────────────
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

// ── Sync status badge ──────────────────────────────────────────────────────
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

// ── Main App ───────────────────────────────────────────────────────────────
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

  // ── Load from Google Sheets on mount ────────────────────────────────────
  useEffect(() => {
    fetchEntries();
  }, []);

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

  // ── Add entry ────────────────────────────────────────────────────────────
  async function addEntry() {
    if (!note.trim() || !amount || !date) { showToast("請填寫說明、金額、日期"); return; }
    const entry = { id: String(Date.now()), note: note.trim(), amount: parseFloat(amount), date, cat: selCat, who };
    setEntries(prev => [entry, ...prev]); // optimistic update
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

  // ── Delete entry ─────────────────────────────────────────────────────────
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

  // ── Receipt scan ─────────────────────────────────────────────────────────
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

  // ── Export CSV ───────────────────────────────────────────────────────────
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
  const catTotals = CATS.map(c => monthEntries.filter(e=>e.cat===c.name).reduce((s,e)=>s+e.amount,0));
  const now = new Date();

  // ── Styles ────────────────────────────────────────────────────────────────
  const S = {
    root: { fontFamily:"'DM Sans',system-ui,sans-serif", padding:"14px 12px", maxWidth:480, margin:"0 auto", background:"#F8FAFC", minHeight:"100vh" },
    header: { display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 },
    h1: { fontSize:22, fontWeight:700, color:"#0F172A", lineHeight:1.2 },
    sub: { fontSize:11, color:"#94A3B8", marginTop:2 },
    tabs: { display:"flex", background:"#E8EDF5", borderRadius:10, padding:3, marginBottom:14 },
    tab: (a) => ({ flex:1, padding:"7px 0", fontSize:12, fontWeight:600, border:"none", borderRadius:8,
      cursor:"pointer", transition:"all .2s", background:a?"#fff":"transparent",
      color:a?"#0F172A":"#64748B", boxShadow:a?"0 1px 3px rgba(0,0,0,.1)":"none" }),
    card: { background:"#fff", borderRadius:14, padding:"14px 16px", marginBottom:12, boxShadow:"0 1px 3px rgba(0,0,0,.06)" },
    metrics: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 },
    metric: (a) => ({ background:a?"#EEF2FF":"#F8FAFC", borderRadius:12, padding:"12px 14px", border:`1px solid ${a?"#C7D2FE":"#E8EDF5"}` }),
    mLabel: { fontSize:10, color:"#94A3B8", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:4 },
    mVal: (w) => ({ fontSize:21, fontWeight:700, color:w?"#EF4444":"#0F172A" }),
    mSub: { fontSize:10, color:"#94A3B8", marginTop:2 },
    label: { fontSize:11, color:"#64748B", fontWeight:600, marginBottom:5, display:"block" },
    input: { width:"100%", padding:"9px 12px", border:"1.5px solid #E2E8F0", borderRadius:9, fontSize:14,
      outline:"none", background:"#fff", color:"#0F172A", fontFamily:"inherit" },
    pillRow: { display:"flex", flexWrap:"wrap", gap:6, marginBottom:12 },
    whoPill: (a) => ({ padding:"6px 14px", borderRadius:20, fontSize:12, fontWeight:600, border:"1.5px solid",
      cursor:"pointer", background:a?"#0F172A":"#fff", color:a?"#fff":"#64748B", borderColor:a?"#0F172A":"#E2E8F0" }),
    catPill: (a,c) => ({ padding:"5px 11px", borderRadius:20, fontSize:12, fontWeight:600, border:"1.5px solid",
      cursor:"pointer", background:a?c+"18":"#F8FAFC", color:a?c:"#64748B", borderColor:a?c:"#E2E8F0" }),
    row2: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 },
    addBtn: { width:"100%", padding:"12px 0", borderRadius:10, fontSize:14, fontWeight:700,
      background:"#4361EE", color:"#fff", border:"none", cursor:"pointer" },
    scanBtn: { width:"100%", padding:"11px 0", borderRadius:10, fontSize:13, fontWeight:600,
      border:"2px dashed #CBD5E1", background:"transparent", color:"#4361EE", cursor:"pointer",
      marginBottom:12, display:"flex", alignItems:"center", justifyContent:"center", gap:6 },
    entryRow: { display:"flex", alignItems:"center", gap:9, padding:"10px 0", borderBottom:"1px solid #F1F5F9" },
    dot: (c) => ({ width:8, height:8, borderRadius:"50%", background:c, flexShrink:0 }),
    eName: { fontSize:13, fontWeight:600, color:"#0F172A", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:130 },
    eMeta: { fontSize:10, color:"#94A3B8" },
    eWho: { fontSize:10, padding:"2px 8px", borderRadius:10, background:"#F1F5F9", color:"#64748B", fontWeight:600 },
    eAmt: { marginLeft:"auto", fontSize:13, fontWeight:700, color:"#0F172A", whiteSpace:"nowrap" },
    delBtn: { background:"none", border:"none", cursor:"pointer", color:"#CBD5E1", fontSize:15, padding:"0 2px" },
    budRow: { marginBottom:14 },
    budMeta: { display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:13, marginBottom:5 },
    budInput: { width:70, padding:"3px 8px", border:"1.5px solid #E2E8F0", borderRadius:6, fontSize:12, textAlign:"right", outline:"none", fontFamily:"inherit" },
    barBg: { height:5, background:"#F1F5F9", borderRadius:3, overflow:"hidden" },
    barFill: (p,c) => ({ height:"100%", width:p+"%", background:c, borderRadius:3, transition:"width .5s" }),
    legendGrid: { display:"flex", flexWrap:"wrap", gap:"6px 14px", marginBottom:10 },
    lgItem: { display:"flex", alignItems:"center", gap:5, fontSize:11, color:"#64748B" },
    lgDot: (c) => ({ width:9, height:9, borderRadius:2, background:c, flexShrink:0 }),
    exportBtn: { width:"100%", padding:10, borderRadius:10, fontSize:12, fontWeight:600,
      background:"#F8FAFC", border:"1.5px solid #E2E8F0", cursor:"pointer", color:"#64748B", marginTop:8 },
    refreshBtn: { padding:"6px 14px", borderRadius:8, fontSize:12, fontWeight:600,
      background:"none", border:"1.5px solid #E2E8F0", cursor:"pointer", color:"#64748B" },
    toast: { position:"fixed", bottom:20, left:"50%", transform:"translateX(-50%)",
      background:"#0F172A", color:"#fff", padding:"9px 20px", borderRadius:20, fontSize:12, fontWeight:600, zIndex:999 },
    spinnerWrap: { display:"flex", flexDirection:"column", alignItems:"center", gap:8, padding:"16px 0" },
    spinner: { width:26, height:26, border:"3px solid #E2E8F0", borderTopColor:"#4361EE",
      borderRadius:"50%", animation:"spin 0.7s linear infinite" },
    sectionTitle: { fontSize:11, fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:10 },
    divider: { height:1, background:"#F1F5F9", margin:"4px 0 12px" },
  };

  return (
    <div style={S.root}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&display=swap');`}</style>
      {toast && <div style={S.toast}>{toast}</div>}

      {/* Header */}
      <div style={S.header}>
        <div>
          <div style={S.h1}>家庭記帳</div>
          <div style={S.sub}>Ottawa · {now.getFullYear()} 年 {now.getMonth()+1} 月</div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
          <SyncBadge status={syncStatus} />
          <button style={S.refreshBtn} onClick={fetchEntries}>↻ 重新整理</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={S.tabs}>
        {[["record","記帳"],["list","明細"],["stats","分析"],["budget","預算"]].map(([t,l]) => (
          <button key={t} style={S.tab(tab===t)} onClick={() => setTab(t)}>{l}</button>
        ))}
      </div>

      {/* ── RECORD ── */}
      {tab === "record" && (
        <>
          <div style={S.metrics}>
            <div style={S.metric(true)}>
              <div style={S.mLabel}>本月支出</div>
              <div style={S.mVal(false)}>{fmtCAD(totalSpent)}</div>
              <div style={S.mSub}>{monthEntries.length} 筆記錄</div>
            </div>
            <div style={S.metric(false)}>
              <div style={S.mLabel}>預算剩餘</div>
              <div style={S.mVal(remain < 0)}>{totalBudget ? fmtCAD(remain) : "—"}</div>
              <div style={S.mSub}>{totalBudget ? `已用 ${pct}%` : "尚未設定"}</div>
            </div>
          </div>

          {/* Receipt scan */}
          <div style={S.card}>
            <div style={S.sectionTitle}>📷 上傳收據自動辨識</div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment"
              style={{ display:"none" }} onChange={handleFile} />

            {!scanning && !scanResult && (
              <button style={S.scanBtn} onClick={() => fileRef.current?.click()}>
                <span style={{ fontSize:18 }}>📷</span>
                <span>拍照或選擇收據圖片</span>
              </button>
            )}
            {scanning && (
              <div style={S.spinnerWrap}>
                <div style={S.spinner} />
                <div style={{ fontSize:12, color:"#64748B" }}>AI 辨識中，請稍候…</div>
              </div>
            )}
            {scanError && (
              <div style={{ background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:9, padding:"10px 12px", fontSize:12, color:"#B91C1C", marginBottom:10 }}>
                ⚠️ {scanError}
                <button style={{ marginLeft:8, color:"#4361EE", background:"none", border:"none", cursor:"pointer", fontSize:12 }}
                  onClick={() => fileRef.current?.click()}>重試</button>
              </div>
            )}
            {scanResult && (
              <div style={{ display:"flex", gap:10, background:"#F0F4FF", borderRadius:10, padding:10, marginBottom:12, border:"1px solid #C7D2FE" }}>
                <img src={scanResult.imageUrl} alt="收據" style={{ width:76, height:76, objectFit:"cover", borderRadius:8, flexShrink:0 }} />
                <div style={{ flex:1, fontSize:12, color:"#4361EE" }}>
                  <div style={{ fontWeight:700, marginBottom:4, color:"#3730A3" }}>✓ 辨識完成，已自動填入</div>
                  <div>金額：{scanResult.amount ? fmtCAD(scanResult.amount) : "—"}</div>
                  <div>日期：{scanResult.date ?? "—"}</div>
                  <div>類別：{scanResult.cat ?? "—"}</div>
                  <button style={{ marginTop:6, fontSize:11, color:"#94A3B8", background:"none", border:"none", cursor:"pointer", padding:0 }}
                    onClick={() => { setScanResult(null); fileRef.current?.click(); }}>重新辨識</button>
                </div>
              </div>
            )}
          </div>

          {/* Form */}
          <div style={S.card}>
            <div style={S.sectionTitle}>✏️ 確認或手動輸入</div>
            <label style={S.label}>記帳人</label>
            <div style={S.pillRow}>
              {WHO_LIST.map(w => <button key={w} style={S.whoPill(who===w)} onClick={() => setWho(w)}>{w}</button>)}
            </div>
            <label style={S.label}>類別</label>
            <div style={S.pillRow}>
              {CATS.map(c => (
                <button key={c.name} style={S.catPill(selCat===c.name, c.color)} onClick={() => setSelCat(c.name)}>
                  {c.icon} {c.name}
                </button>
              ))}
            </div>
            <div style={{ marginBottom:12 }}>
              <label style={S.label}>說明</label>
              <input style={S.input} placeholder="e.g. Costco 採購" value={note} onChange={e => setNote(e.target.value)} />
            </div>
            <div style={S.row2}>
              <div>
                <label style={S.label}>金額 (CAD)</label>
                <input style={S.input} type="number" placeholder="0.00" min="0" step="0.01"
                  value={amount} onChange={e => setAmount(e.target.value)} />
              </div>
              <div>
                <label style={S.label}>日期</label>
                <input style={S.input} type="date" value={date} onChange={e => setDate(e.target.value)} />
              </div>
            </div>
            <button style={S.addBtn} onClick={addEntry}>+ 新增並同步到 Google Sheet</button>
          </div>
        </>
      )}

      {/* ── LIST ── */}
      {tab === "list" && (
        <>
          {syncStatus === "loading" && (
            <div style={{ ...S.spinnerWrap, padding:"32px 0" }}>
              <div style={S.spinner} />
              <div style={{ fontSize:12, color:"#64748B" }}>從 Google Sheet 載入中…</div>
            </div>
          )}
          {syncStatus !== "loading" && (
            <div style={S.card}>
              {!monthEntries.length
                ? <div style={{ textAlign:"center", color:"#94A3B8", fontSize:13, padding:"24px 0" }}>本月尚無記錄</div>
                : monthEntries.map(e => {
                    const cat = catOf(e.cat);
                    return (
                      <div key={e.id} style={S.entryRow}>
                        <div style={S.dot(cat.color)} />
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={S.eName}>{e.note}</div>
                          <div style={S.eMeta}>{e.date} · {e.cat}</div>
                        </div>
                        <div style={S.eWho}>{e.who}</div>
                        <div style={S.eAmt}>{fmtCAD(e.amount)}</div>
                        <button style={S.delBtn} onClick={() => delEntry(e.id)} aria-label="刪除">✕</button>
                      </div>
                    );
                  })
              }
            </div>
          )}
          <button style={S.exportBtn} onClick={exportCSV}>↓ 匯出 CSV</button>
        </>
      )}

      {/* ── STATS ── */}
      {tab === "stats" && (
        <>
          <div style={S.card}>
            <div style={S.sectionTitle}>支出分布</div>
            <div style={{ display:"flex", justifyContent:"center", marginBottom:10 }}>
              <Donut data={catTotals} colors={CATS.map(c=>c.color)} />
            </div>
            <div style={S.legendGrid}>
              {CATS.map((c,i) => catTotals[i] > 0 && (
                <div key={c.name} style={S.lgItem}>
                  <div style={S.lgDot(c.color)} />
                  <span>{c.name}</span>
                  <span style={{ fontWeight:700, color:"#0F172A" }}>${Math.round(catTotals[i])}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={S.card}>
            <div style={S.sectionTitle}>每日支出趨勢</div>
            <Bars entries={entries} />
          </div>
          <div style={S.card}>
            <div style={S.sectionTitle}>記帳人分布</div>
            {WHO_LIST.map(w => {
              const wTotal = monthEntries.filter(e=>e.who===w).reduce((s,e)=>s+e.amount,0);
              const wPct = totalSpent ? Math.round((wTotal/totalSpent)*100) : 0;
              return (
                <div key={w} style={{ marginBottom:10 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:5 }}>
                    <span style={{ fontWeight:600 }}>{w}</span>
                    <span style={{ color:"#64748B" }}>{fmtCAD(wTotal)} ({wPct}%)</span>
                  </div>
                  <div style={S.barBg}><div style={S.barFill(wPct,"#4361EE")} /></div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── BUDGET ── */}
      {tab === "budget" && (
        <div style={S.card}>
          <div style={S.sectionTitle}>月預算設定</div>
          {CATS.map(c => {
            const spent = monthEntries.filter(e=>e.cat===c.name).reduce((s,e)=>s+e.amount,0);
            const bud = Number(budgets[c.name]||0);
            const p = bud ? Math.min(100,Math.round((spent/bud)*100)) : 0;
            const over = bud > 0 && spent > bud;
            return (
              <div key={c.name} style={S.budRow}>
                <div style={S.budMeta}>
                  <span style={{ fontWeight:600, color:"#0F172A" }}>{c.icon} {c.name}</span>
                  <div style={{ display:"flex", alignItems:"center", gap:4, fontSize:12, color:over?"#EF4444":"#64748B" }}>
                    <span>${Math.round(spent)} /</span>
                    <input style={{ ...S.budInput, borderColor:over?"#FCA5A5":"#E2E8F0" }}
                      type="number" value={bud} min="0" step="50"
                      onChange={e => {
                        const nb = { ...budgets, [c.name]: Number(e.target.value)||0 };
                        setBudgets(nb); saveLS(LS_BUDGETS, nb);
                      }} />
                  </div>
                </div>
                <div style={S.barBg}><div style={S.barFill(p, over?"#EF4444":c.color)} /></div>
              </div>
            );
          })}
          <div style={S.divider} />
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, fontWeight:700 }}>
            <span>總預算</span>
            <span style={{ color:"#4361EE" }}>{fmtCAD(totalBudget)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
