import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5-5";

// 回傳格式：每個建議都是一道（或一組）可以讓兩大兩小吃的餐
const SUGGESTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "summary", "minutes", "equipment", "ingredients", "missing", "steps", "kidTips", "prepAhead"],
        properties: {
          name: { type: "string" },
          summary: { type: "string" },
          minutes: { type: "integer" },
          equipment: { type: "array", items: { type: "string" } },
          ingredients: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["item", "amount"],
              properties: { item: { type: "string" }, amount: { type: "string" } },
            },
          },
          missing: { type: "array", items: { type: "string" } },
          steps: { type: "array", items: { type: "string" } },
          kidTips: { type: "string" },
          prepAhead: { type: "string" },
        },
      },
    },
  },
};

const SYSTEM = `你是一位幫忙家庭每日備餐的料理助手，家庭成員是兩位大人、兩位小孩（5 歲和 8 歲）。
- 份量一律以「兩大兩小」計算，食材要寫出具體份量（克、顆、湯匙）。
- 只能使用使用者列出的廚房設備；優先用掉「快過期」的食材。
- 以現有食材為主，若缺少關鍵食材請列在 missing（越少越好，常見調味料可假設家裡有：鹽、糖、醬油、油、胡椒）。
- kidTips：寫給小孩的調整（不辣、切小塊、挑刺、減鹽、份量等）。
- prepAhead：可以前一晚或週末先備好的部分，沒有就寫「無」。
- 參考使用者過去的料理紀錄：評分高的可以變化出現，最近幾天做過的避免重複。
- 「家裡的拿手菜」代表全家的口味偏好與常用調味料（例如市售醬汁），可以直接推薦或做變化。
- 全部使用繁體中文。`;

export async function suggestMeals({ apiKey, equipment, ingredients, history, meal, count, notes }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  // 有日期的是實際做過的紀錄；沒有日期的是匯入的過往食譜
  const recent = history.filter(h => h.date).slice(0, 30).map(h => `${h.date} ${h.name}${h.rating ? `（${h.rating}★）` : ""}`);
  const repertoire = history.filter(h => !h.date).map(h => `${h.name}${h.recipe?.summary ? `：${h.recipe.summary}` : ""}`);
  const prompt = [
    `今天要準備：${meal}，請給我 ${count} 個不同的建議。`,
    `廚房設備：${equipment.join("、") || "（未設定）"}`,
    `現有食材：\n${ingredients.map(i => `- ${i.name}${i.qty ? ` ${i.qty}` : ""}${i.expiry ? `（${i.expiry} 到期）` : ""}`).join("\n") || "（未設定）"}`,
    `最近料理紀錄：\n${recent.join("\n") || "（尚無）"}`,
    repertoire.length ? `家裡的拿手菜：\n${repertoire.join("\n")}` : "",
    notes?.trim() ? `額外需求：${notes.trim()}` : "",
  ].filter(Boolean).join("\n\n");

  let response;
  try {
    // fallbacks: 若主模型婉拒，伺服器端自動改由備援模型回答
    response = await client.beta.messages.create({
      model: MODEL,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SUGGESTION_SCHEMA } },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error("API Key 無效，請到「設定」重新輸入");
    if (err instanceof Anthropic.RateLimitError) throw new Error("請求太頻繁，請稍後再試");
    if (err instanceof Anthropic.APIConnectionError) throw new Error("無法連線，請檢查網路");
    if (err instanceof Anthropic.APIError) throw new Error(`API 錯誤 ${err.status}`);
    throw err;
  }

  if (response.stop_reason === "refusal") throw new Error("AI 無法提供這次的建議，請調整需求再試");
  if (response.stop_reason === "max_tokens") throw new Error("回覆太長被截斷，請減少建議數量");
  const text = response.content.find(b => b.type === "text")?.text ?? "";
  return JSON.parse(text).suggestions;
}
