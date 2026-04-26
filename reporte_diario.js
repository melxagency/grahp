const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// =========================
// 🇨🇺 AYER (CUBA)
// =========================
function getYesterdayCuba() {
  const now = new Date();
  const cubaOffsetMs = -5 * 60 * 60 * 1000;

  const cubaNow = new Date(now.getTime() + cubaOffsetMs);
  cubaNow.setDate(cubaNow.getDate() - 1);

  return cubaNow.toISOString().split("T")[0];
}

// =========================
// 🧠 RANGO AMPLIO (FIX FB)
// =========================
function getRange(day) {
  const start = new Date(day);
  start.setDate(start.getDate() - 1);

  const end = new Date(day);
  end.setDate(end.getDate() + 1);

  return {
    since: start.toISOString(),
    until: end.toISOString(),
  };
}

// =========================
// 🇨🇺 VALIDAR MISMO DÍA
// =========================
function isSameDayCuba(dateStr, targetDay) {
  const cubaOffset = -5 * 60 * 60 * 1000;

  const d = new Date(new Date(dateStr).getTime() + cubaOffset)
    .toISOString()
    .split("T")[0];

  return d === targetDay;
}

// =========================
// 📊 INSIGHTS (IMP + ENG)
// =========================
async function getMetric(pageId, token, metric, day) {
  try {
    const res = await axios.get(
      `https://graph.facebook.com/v19.0/${pageId}/insights`,
      {
        params: {
          metric,
          period: "day",
          since: day,
          until: day,
          access_token: token,
        },
      }
    );

    const values = res.data.data?.[0]?.values || [];
    return values[0]?.value || 0;
  } catch (err) {
    console.log(`❌ METRIC ERROR ${metric}:`, err.response?.data || err.message);
    return 0;
  }
}

// =========================
// ❤️ REACTIONS
// =========================
async function getReactions(pageId, token, day) {
  let url = `https://graph.facebook.com/v19.0/${pageId}/posts`;
  let total = 0;

  const range = getRange(day);

  try {
    while (url) {
      const res = await axios.get(url, {
        params: {
          fields: "created_time,reactions.summary(true)",
          since: range.since,
          until: range.until,
          limit: 100,
          access_token: token,
        },
      });

      for (const post of res.data.data || []) {
        if (isSameDayCuba(post.created_time, day)) {
          total += post.reactions?.summary?.total_count || 0;
        }
      }

      url = res.data.paging?.next || null;
    }
  } catch (err) {
    console.log("❌ REACTIONS ERROR:", err.response?.data || err.message);
  }

  return total;
}

// =========================
// 🔥 SHARES
// =========================
async function getShares(pageId, token, day) {
  let url = `https://graph.facebook.com/v19.0/${pageId}/posts`;
  let total = 0;

  const range = getRange(day);

  try {
    while (url) {
      const res = await axios.get(url, {
        params: {
          fields: "created_time,shares",
          since: range.since,
          until: range.until,
          limit: 100,
          access_token: token,
        },
      });

      for (const post of res.data.data || []) {
        if (isSameDayCuba(post.created_time, day)) {
          total += post.shares?.count || 0;
        }
      }

      url = res.data.paging?.next || null;
    }
  } catch (err) {
    console.log("❌ SHARE ERROR:", err.response?.data || err.message);
  }

  return total;
}

// =========================
// 🚀 MAIN
// =========================
async function main() {
  const { data: pages } = await supabase.from("pages").select("*");

  const day = getYesterdayCuba();

  console.log("📅 Día:", day);

  for (const page of pages) {
    const fbPageId = page.id_page;
    const dbPageId = page.id;
    const token = page.token;

    if (!fbPageId || !token) continue;

    console.log(`📊 Página ${dbPageId}`);

    // =========================
    // 🔍 EVITAR DUPLICADOS
    // =========================
    const { data: exists } = await supabase
      .from("reporte_diario")
      .select("id_record")
      .eq("pagina", dbPageId)
      .eq("fecha", day)
      .maybeSingle();

    if (exists) {
      console.log(`⏭️ YA EXISTE ${dbPageId}`);
      continue;
    }

    // =========================
    // 📊 MÉTRICAS
    // =========================
    const impresiones = await getMetric(
      fbPageId,
      token,
      "page_impressions_unique",
      day
    );

    const engagement = await getMetric(
      fbPageId,
      token,
      "page_post_engagements",
      day
    );

    const reactions = await getReactions(fbPageId, token, day);

    const share = await getShares(fbPageId, token, day);

    const result = {
      impresiones,
      engagement,
      reactions,
      share,
    };

    console.log("📈", result);

    // =========================
    // 💾 INSERT
    // =========================
    await supabase.from("reporte_diario").insert({
      pagina: dbPageId,
      impresiones,
      reaction: reactions,
      engagement,
      share,
      engagement_real: engagement,
      fecha: day,
      created_at: new Date().toISOString(),
    });

    console.log(`✅ INSERT ${dbPageId}`);
  }
}

main();
