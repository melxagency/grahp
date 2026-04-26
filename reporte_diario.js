const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const FACEBOOK_TOKEN = process.env.PAGE_TOKEN; // ✅ TOKEN GLOBAL

// =========================
// 🇨🇺 FECHA CUBA
// =========================
function getCubaDate() {
  const now = new Date();
  const cubaOffsetMs = -5 * 60 * 60 * 1000;
  return new Date(now.getTime() + cubaOffsetMs);
}

// =========================
// 📊 METRICS META
// =========================
async function getMetric(pageId, metric, since, until) {
  try {
    const res = await axios.get(
      `https://graph.facebook.com/v19.0/${pageId}/insights`,
      {
        params: {
          metric,
          period: "day",
          since,
          until,
          access_token: FACEBOOK_TOKEN,
        },
      }
    );

    const values = res.data.data?.[0]?.values || [];
    return values.reduce((s, d) => s + (Number(d.value) || 0), 0);
  } catch {
    return 0;
  }
}

// =========================
// 🔥 SHARE TOTAL POSTS
// =========================
async function getTotalShares(pageId) {
  let url = `https://graph.facebook.com/v19.0/${pageId}/posts`;
  let total = 0;

  try {
    while (url) {
      const res = await axios.get(url, {
        params: {
          fields: "shares",
          limit: 100,
          access_token: FACEBOOK_TOKEN,
        },
      });

      for (const post of res.data.data || []) {
        total += post.shares?.count || 0;
      }

      url = res.data.paging?.next || null;
    }
  } catch {}

  return total;
}

// =========================
// 📅 GENERAR DÍAS
// =========================
function generateDays(start, end) {
  const days = [];
  const current = new Date(start);

  while (current <= end) {
    days.push(new Date(current).toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }

  return days;
}

// =========================
// 🚀 MAIN
// =========================
async function main() {
  const { data: pages } = await supabase.from("pages").select("*");

  const today = getCubaDate();

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const startDate = new Date("2026-03-01");

  const days = generateDays(startDate, yesterday);

  for (const day of days) {
    for (const page of pages) {
      const fbPageId = page.id_page;
      const dbPageId = page.id;

      if (!fbPageId) continue;

      // =========================
      // 🔍 EVITAR DUPLICADOS
      // =========================
      const { data: exists } = await supabase
        .from("reporte_diario")
        .select("id_record")
        .eq("pagina", dbPageId)
        .eq("fecha", day)
        .maybeSingle();

      if (exists) continue;

      // =========================
      // 📊 METRICS
      // =========================
      const impresiones = await getMetric(
        fbPageId,
        "page_impressions_unique",
        day,
        day
      );

      const reactions = await getMetric(
        fbPageId,
        "page_actions_post_reactions_like_total",
        day,
        day
      );

      const engagement = await getMetric(
        fbPageId,
        "page_post_engagements",
        day,
        day
      );

      const share = await getTotalShares(fbPageId);

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

      console.log(`✅ ${dbPageId} → ${day}`);
    }
  }
}

main();
