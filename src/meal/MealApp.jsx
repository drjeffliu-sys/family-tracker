import { useState, useRef } from "react";
import { suggestMeals } from "./mealApi";

// ── Constants ──────────────────────────────────────────────────────────────
const LS_EQUIP = "meal_equipment_v1";
const LS_INGR = "meal_ingredients_v1";
const LS_HISTORY = "meal_history_v1";
const LS_KEY = "meal_api_key_v1";

const EQUIP_PRESETS = ["電鍋", "瓦斯爐 / 電磁爐", "平底鍋", "炒鍋", "湯鍋", "烤箱", "氣炸鍋", "微波爐", "壓力鍋 (Instant Pot)", "慢燉鍋", "果汁機 / 調理機", "蒸籠", "烤盤"];
const MEALS = ["早餐", "午餐便當", "晚餐", "週末備料"];

const todayStr = () => new Date().toISOString().slice(0, 10);
const daysUntil = (d) => Math.round((new Date(d) - new Date(todayStr())) / 86400000);
const loadLS = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } };
const saveLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// state + localStorage 同步
function usePersisted(key, fallback) {
  const [val, setVal] = useState(() => loadLS(key, fallback));
  const set = (next) => setVal(prev => { const v = typeof next === "function" ? next(prev) : next; saveLS(key, v); return v; });
  return [val, set];
}

function Stars({ value, onChange }) {
  return (
    <span>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} onClick={() => onChange?.(n === value ? 0 : n)}
          style={{ background: "none", border: "none", cursor: onChange ? "pointer" : "default", padding: 0, fontSize: 16, color: n <= value ? "#F59E0B" : "#E2E8F0" }}>★</button>
      ))}
    </span>
  );
}

function Recipe({ r, S }) {
  return (
    <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.6 }}>
      {r.summary && <div style={{ marginBottom: 6 }}>{r.summary}</div>}
      <div style={{ color: "#64748B", marginBottom: 6 }}>⏱ {r.minutes} 分鐘 · 🔧 {(r.equipment || []).join("、")}</div>
      <div style={S.miniTitle}>食材（兩大兩小）</div>
      <ul style={S.ul}>{(r.ingredients || []).map((i, k) => <li key={k}>{i.item} — {i.amount}</li>)}</ul>
      {r.missing?.length > 0 && (
        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "6px 10px", margin: "6px 0", color: "#92400E" }}>
          🛒 需要補買：{r.missing.join("、")}
        </div>
      )}
      <div style={S.miniTitle}>步驟</div>
      <ol style={S.ul}>{(r.steps || []).map((s, k) => <li key={k}>{s}</li>)}</ol>
      {r.kidTips && <div><b>👧 小孩版：</b>{r.kidTips}</div>}
      {r.prepAhead && r.prepAhead !== "無" && <div><b>🗓 可先備：</b>{r.prepAhead}</div>}
    </div>
  );
}

export default function MealApp() {
  const [tab, setTab] = useState("suggest");
  const [equipment, setEquipment] = usePersisted(LS_EQUIP, ["電鍋", "瓦斯爐 / 電磁爐", "平底鍋"]);
  const [ingredients, setIngredients] = usePersisted(LS_INGR, []);
  const [history, setHistory] = usePersisted(LS_HISTORY, []);
  const [apiKey, setApiKey] = usePersisted(LS_KEY, "");

  const [meal, setMeal] = useState("晚餐");
  const [count, setCount] = useState(3);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [openIdx, setOpenIdx] = useState(0);

  const [ingName, setIngName] = useState("");
  const [ingQty, setIngQty] = useState("");
  const [ingExp, setIngExp] = useState("");
  const [customEquip, setCustomEquip] = useState("");

  const [query, setQuery] = useState("");
  const [openHist, setOpenHist] = useState(null);
  const importRef = useRef();

  const [toast, setToast] = useState("");
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2200); };

  async function generate() {
    if (!apiKey) { setTab("settings"); showToast("請先輸入 Claude API Key"); return; }
    if (!ingredients.length) { setTab("pantry"); showToast("請先輸入現有食材"); return; }
    setLoading(true); setError(""); setSuggestions([]);
    try {
      const res = await suggestMeals({ apiKey, equipment, ingredients, history, meal, count, notes });
      setSuggestions(res); setOpenIdx(0);
    } catch (e) {
      setError(e.message || "產生建議失敗");
    } finally { setLoading(false); }
  }

  function cookIt(r) {
    const entry = { id: String(Date.now()), date: todayStr(), meal, name: r.name, rating: 0, note: "", recipe: r };
    setHistory(prev => [entry, ...prev]);
    showToast(`已記錄「${r.name}」到料理紀錄 ✓`);
  }

  function addIngredient() {
    if (!ingName.trim()) return;
    setIngredients(prev => [...prev, { id: String(Date.now()), name: ingName.trim(), qty: ingQty.trim(), expiry: ingExp }]);
    setIngName(""); setIngQty(""); setIngExp("");
  }

  function toggleEquip(e) {
    setEquipment(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e]);
  }

  function updateHist(id, patch) {
    setHistory(prev => prev.map(h => h.id === id ? { ...h, ...patch } : h));
  }

  function exportJSON() {
    const blob = JSON.stringify({ equipment, ingredients, history }, null, 2);
    const a = document.createElement("a");
    a.href = "data:application/json;charset=utf-8," + encodeURIComponent(blob);
    a.download = `備餐資料_${todayStr()}.json`;
    a.click();
  }

  function importJSON(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const d = JSON.parse(ev.target.result);
        if (Array.isArray(d.equipment)) setEquipment(d.equipment);
        if (Array.isArray(d.ingredients)) setIngredients(d.ingredients);
        if (Array.isArray(d.history)) setHistory(d.history);
        showToast("匯入完成 ✓");
      } catch { showToast("檔案格式錯誤"); }
      e.target.value = "";
    };
    reader.readAsText(file);
  }

  const sortedIngr = [...ingredients].sort((a, b) => (a.expiry || "9999").localeCompare(b.expiry || "9999"));
  const q = query.trim().toLowerCase();
  const filteredHist = history.filter(h => !q || h.name.toLowerCase().includes(q) || (h.recipe?.ingredients || []).some(i => i.item.toLowerCase().includes(q)) || (h.note || "").toLowerCase().includes(q));
  const timesCooked = history.reduce((m, h) => { m[h.name] = (m[h.name] || 0) + 1; return m; }, {});

  const S = {
    root: { fontFamily: "'DM Sans',system-ui,sans-serif", padding: "14px 12px", maxWidth: 480, margin: "0 auto", background: "#F8FAFC", minHeight: "100vh" },
    h1: { fontSize: 22, fontWeight: 700, color: "#0F172A", lineHeight: 1.2 },
    sub: { fontSize: 11, color: "#94A3B8", marginTop: 2, marginBottom: 14 },
    tabs: { display: "flex", background: "#E8EDF5", borderRadius: 10, padding: 3, marginBottom: 14 },
    tab: (a) => ({ flex: 1, padding: "7px 0", fontSize: 12, fontWeight: 600, border: "none", borderRadius: 8, cursor: "pointer", background: a ? "#fff" : "transparent", color: a ? "#0F172A" : "#64748B", boxShadow: a ? "0 1px 3px rgba(0,0,0,.1)" : "none" }),
    card: { background: "#fff", borderRadius: 14, padding: "14px 16px", marginBottom: 12, boxShadow: "0 1px 3px rgba(0,0,0,.06)" },
    sectionTitle: { fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 },
    miniTitle: { fontSize: 11, fontWeight: 700, color: "#64748B", marginTop: 6 },
    ul: { margin: "4px 0 6px", paddingLeft: 20 },
    label: { fontSize: 11, color: "#64748B", fontWeight: 600, marginBottom: 5, display: "block" },
    input: { width: "100%", padding: "9px 12px", border: "1.5px solid #E2E8F0", borderRadius: 9, fontSize: 14, outline: "none", background: "#fff", color: "#0F172A", fontFamily: "inherit", boxSizing: "border-box" },
    pillRow: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 },
    pill: (a) => ({ padding: "6px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, border: "1.5px solid", cursor: "pointer", background: a ? "#06B6A418" : "#F8FAFC", color: a ? "#0E7C70" : "#64748B", borderColor: a ? "#06B6A4" : "#E2E8F0" }),
    btn: { width: "100%", padding: "12px 0", borderRadius: 10, fontSize: 14, fontWeight: 700, background: "#06B6A4", color: "#fff", border: "none", cursor: "pointer" },
    ghostBtn: { padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "#fff", border: "1.5px solid #E2E8F0", cursor: "pointer", color: "#64748B" },
    row: { display: "flex", alignItems: "center", gap: 9, padding: "9px 0", borderBottom: "1px solid #F1F5F9" },
    delBtn: { background: "none", border: "none", cursor: "pointer", color: "#CBD5E1", fontSize: 15, padding: "0 2px" },
    toast: { position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "#0F172A", color: "#fff", padding: "9px 20px", borderRadius: 20, fontSize: 12, fontWeight: 600, zIndex: 999 },
    spinner: { width: 26, height: 26, border: "3px solid #E2E8F0", borderTopColor: "#06B6A4", borderRadius: "50%", animation: "spin 0.7s linear infinite" },
  };

  return (
    <div style={S.root}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      {toast && <div style={S.toast}>{toast}</div>}
      <div style={S.h1}>今天吃什麼</div>
      <div style={S.sub}>兩大兩小備餐助手 · 食材 {ingredients.length} 項 · 已記錄 {history.length} 道</div>

      <div style={S.tabs}>
        {[["suggest", "建議"], ["pantry", "食材"], ["equip", "設備"], ["history", "紀錄"], ["settings", "設定"]].map(([t, l]) => (
          <button key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>{l}</button>
        ))}
      </div>

      {tab === "suggest" && (
        <>
          <div style={S.card}>
            <label style={S.label}>要準備哪一餐</label>
            <div style={S.pillRow}>{MEALS.map(m => <button key={m} style={S.pill(meal === m)} onClick={() => setMeal(m)}>{m}</button>)}</div>
            <label style={S.label}>建議數量</label>
            <div style={S.pillRow}>{[1, 2, 3].map(n => <button key={n} style={S.pill(count === n)} onClick={() => setCount(n)}>{n} 個</button>)}</div>
            <label style={S.label}>額外需求（選填）</label>
            <input style={{ ...S.input, marginBottom: 12 }} placeholder="e.g. 30 分鐘內、小孩不吃青椒、想吃麵" value={notes} onChange={e => setNotes(e.target.value)} />
            <button style={{ ...S.btn, opacity: loading ? 0.6 : 1 }} disabled={loading} onClick={generate}>🍳 產生備餐建議</button>
          </div>
          {loading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "16px 0" }}>
              <div style={S.spinner} />
              <div style={{ fontSize: 12, color: "#64748B" }}>正在依照你的食材和設備想菜單…</div>
            </div>
          )}
          {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 9, padding: "10px 12px", fontSize: 12, color: "#B91C1C", marginBottom: 12 }}>⚠️ {error}</div>}
          {suggestions.map((r, i) => (
            <div key={i} style={S.card}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => setOpenIdx(openIdx === i ? -1 : i)}>
                <div style={{ flex: 1, fontSize: 15, fontWeight: 700, color: "#0F172A" }}>{r.name}</div>
                {timesCooked[r.name] && <span style={{ fontSize: 10, color: "#64748B", background: "#F1F5F9", padding: "2px 8px", borderRadius: 10 }}>做過 {timesCooked[r.name]} 次</span>}
                <span style={{ fontSize: 12, color: "#94A3B8" }}>{r.minutes} 分 {openIdx === i ? "▲" : "▼"}</span>
              </div>
              {openIdx === i && (
                <div style={{ marginTop: 10 }}>
                  <Recipe r={r} S={S} />
                  <button style={{ ...S.btn, marginTop: 12, padding: "10px 0", fontSize: 13 }} onClick={() => cookIt(r)}>✓ 今天就做這道（存到紀錄）</button>
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {tab === "pantry" && (
        <>
          <div style={S.card}>
            <div style={S.sectionTitle}>新增食材</div>
            <input style={{ ...S.input, marginBottom: 8 }} placeholder="食材名稱，e.g. 雞腿" value={ingName} onChange={e => setIngName(e.target.value)} onKeyDown={e => e.key === "Enter" && addIngredient()} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
              <input style={S.input} placeholder="數量 e.g. 4 隻" value={ingQty} onChange={e => setIngQty(e.target.value)} />
              <input style={S.input} type="date" value={ingExp} onChange={e => setIngExp(e.target.value)} title="到期日（選填）" />
            </div>
            <button style={S.btn} onClick={addIngredient}>+ 加入食材</button>
          </div>
          <div style={S.card}>
            <div style={S.sectionTitle}>冰箱 / 食物櫃（依到期日排序）</div>
            {!sortedIngr.length && <div style={{ textAlign: "center", color: "#94A3B8", fontSize: 13, padding: "16px 0" }}>還沒有食材</div>}
            {sortedIngr.map(i => {
              const d = i.expiry ? daysUntil(i.expiry) : null;
              const warn = d !== null && d <= 2;
              return (
                <div key={i.id} style={S.row}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{i.name} <span style={{ fontWeight: 400, color: "#64748B" }}>{i.qty}</span></div>
                    {i.expiry && <div style={{ fontSize: 10, color: warn ? "#EF4444" : "#94A3B8" }}>{d < 0 ? "已過期" : d === 0 ? "今天到期" : `${d} 天後到期`} · {i.expiry}</div>}
                  </div>
                  <button style={S.delBtn} onClick={() => setIngredients(prev => prev.filter(x => x.id !== i.id))} aria-label="用完">✕</button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === "equip" && (
        <div style={S.card}>
          <div style={S.sectionTitle}>我有的廚房設備（點選切換）</div>
          <div style={S.pillRow}>
            {[...new Set([...EQUIP_PRESETS, ...equipment])].map(e => <button key={e} style={S.pill(equipment.includes(e))} onClick={() => toggleEquip(e)}>{e}</button>)}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={S.input} placeholder="其他設備" value={customEquip} onChange={e => setCustomEquip(e.target.value)} />
            <button style={S.ghostBtn} onClick={() => { if (customEquip.trim()) { setEquipment(prev => [...new Set([...prev, customEquip.trim()])]); setCustomEquip(""); } }}>新增</button>
          </div>
        </div>
      )}

      {tab === "history" && (
        <>
          <input style={{ ...S.input, marginBottom: 12 }} placeholder="🔍 搜尋菜名、食材、備註" value={query} onChange={e => setQuery(e.target.value)} />
          <div style={S.card}>
            {!filteredHist.length && <div style={{ textAlign: "center", color: "#94A3B8", fontSize: 13, padding: "16px 0" }}>{history.length ? "找不到符合的紀錄" : "還沒有料理紀錄，從「建議」選一道開始吧"}</div>}
            {filteredHist.map(h => (
              <div key={h.id} style={{ borderBottom: "1px solid #F1F5F9", padding: "10px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, cursor: "pointer" }} onClick={() => setOpenHist(openHist === h.id ? null : h.id)}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{h.name}</div>
                    <div style={{ fontSize: 10, color: "#94A3B8" }}>{h.date} · {h.meal} · 共做過 {timesCooked[h.name]} 次</div>
                  </div>
                  <Stars value={h.rating} onChange={n => updateHist(h.id, { rating: n })} />
                  <button style={S.delBtn} onClick={() => setHistory(prev => prev.filter(x => x.id !== h.id))} aria-label="刪除">✕</button>
                </div>
                {openHist === h.id && (
                  <div style={{ marginTop: 8 }}>
                    <input style={{ ...S.input, fontSize: 12, marginBottom: 8 }} placeholder="備註：小孩喜不喜歡、下次調整…" value={h.note} onChange={e => updateHist(h.id, { note: e.target.value })} />
                    {h.recipe && <Recipe r={h.recipe} S={S} />}
                    <button style={{ ...S.ghostBtn, marginTop: 8 }} onClick={() => { setHistory(prev => [{ ...h, id: String(Date.now()), date: todayStr(), rating: 0, note: "" }, ...prev]); showToast("已記錄今天再做一次 ✓"); }}>↻ 今天再做一次</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "settings" && (
        <>
          <div style={S.card}>
            <div style={S.sectionTitle}>Claude API Key</div>
            <input style={S.input} type="password" placeholder="sk-ant-..." value={apiKey} onChange={e => setApiKey(e.target.value.trim())} />
            <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 6 }}>只存在這台裝置的瀏覽器裡。到 console.anthropic.com 建立。</div>
          </div>
          <div style={S.card}>
            <div style={S.sectionTitle}>資料備份</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={S.ghostBtn} onClick={exportJSON}>↓ 匯出 JSON</button>
              <button style={S.ghostBtn} onClick={() => importRef.current?.click()}>↑ 匯入 JSON</button>
              <input ref={importRef} type="file" accept="application/json" style={{ display: "none" }} onChange={importJSON} />
            </div>
            <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 6 }}>可用來換手機或在兩台裝置間搬資料。</div>
          </div>
        </>
      )}
    </div>
  );
}
