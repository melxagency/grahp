const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// =========================
// 🇨🇺 FECHA CUBA
// =========================
function getCubaDate() {
  const now = new Date();
  const cubaOffsetMs = -5 * 60 * 60 * 1000;
  return new Date(now.getTime() + cubaOffsetMs);
}

// =========================
// ⛓️ SPLIT EN BLOQUES DE 90 DÍAS
// =========================
function splitDateRange(start, end, maxDays = 90) {
  const ranges = [];
  let current = new Date(start);

  while (current < end) {
    const next = new Date(current);
    next.setDate(next.getDate() + maxDays);

    if (next > end) next.setTime(end.getTime());

    ranges.push({
      since: new Date(current).toISOString().split("T")[0],
      until: new Date(next).toISOString().split("T")[0],
    });

    current = next;
  }

  return ranges;
}

// =========================
// 📊 METRICS META (SEGURA)
// =========================
async function getMetric(pageId, token, metric, since, until) {
  try {
    const res = await axios.get(
      `https://graph.facebook.com/v19.0/${pageId}/insights`,
      {
        params: {
          metric,
          period: "day",
          since,
          until,
          access_token: token,
        },
      }
    );

    const values = res.data.data?.[0]?.values || [];
    return values.reduce((s, d) => s + (Number(d.value) || 0), 0);
  } catch (err) {
    console.log("METRIC ERROR:", metric, err.response?.data || err.message);
    return 0;
  }
}

// =========================
// 🔥 SHARE TOTAL POSTS
// =========================
async function getTotalShares(pageId, token) {
  let url = `https://graph.facebook.com/v19.0/${pageId}/posts`;
  let total = 0;

  try {
    while (url) {
      const res = await axios.get(url, {
        params: {
          fields: "shares",
          limit: 100,
          access_token: token,
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
// 🚀 MAIN
// =========================
async function main() {
  const { data: pages } = await supabase.from("pages").select("*");

  const today = getCubaDate();

  for (const page of pages) {
    const pageId = page.id_page;
    const token = page.token;

    if (!pageId || !token) continue;

    const startDate = new Date(page.fecha_inicio_explotacion || "2023-01-01");

    const ranges = splitDateRange(startDate, today);

    let impresionesTotal = 0;
    let reactionsTotal = 0;
    let engagementTotal = 0;

    // =========================
    // 🔁 ACUMULAR POR BLOQUES
    // =========================
    for (const r of ranges) {
      const nextDay = new Date(r.until);
      nextDay.setDate(nextDay.getDate() + 1);

      impresionesTotal += await getMetric(
        pageId,
        token,
        "page_impressions_unique",
        r.since,
        r.until
      );

      reactionsTotal += await getMetric(
        pageId,
        token,
        "page_actions_post_reactions_like_total",
        r.since,
        r.until
      );

      engagementTotal += await getMetric(
        pageId,
        token,
        "page_post_engagements",
        r.since,
        r.until
      );
    }

    const share = await getTotalShares(pageId, token);

    // =========================
    // 💾 UPSERT ACUMULADO
    // =========================
    const { data: exists } = await supabase
      .from("reporte_diario_acumulado")
      .select("id_record")
      .eq("pagina", page.nombre)
      .maybeSingle();

    const payload = {
      pagina: page.nombre,
      impresiones: impresionesTotal,
      reaction: reactionsTotal,
      engagement: engagementTotal,
      share,
      engagement_real: engagementTotal,
      fecha: today.toISOString().split("T")[0],
      created_at: new Date().toISOString(),
    };

    if (!exists) {
      await supabase.from("reporte_diario_acumulado").insert(payload);
    } else {
      await supabase
        .from("reporte_diario_acumulado")
        .update(payload)
        .eq("pagina", page.nombre);
    }

    console.log("OK ACUMULADO:", page.nombre);
  }
}

main();
