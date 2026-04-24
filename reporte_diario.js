const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// =========================
// 🧠 HELPERS
// =========================
const formatDate = (d) =>
  new Date(d).toISOString().split("T")[0];

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

// =========================
// 🇨🇺 DÍA CUBA (UTC-5)
// =========================
function getCubaDate() {
  const now = new Date();
  const cubaOffsetMs = -5 * 60 * 60 * 1000;
  const cubaTime = new Date(now.getTime() + cubaOffsetMs);
  return cubaTime.toISOString().split("T")[0];
}

// =========================
// 📊 METRICS META
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
    return values.reduce((s, d) => s + (d.value || 0), 0);
  } catch (err) {
    console.log("METRIC ERROR:", err.message);
    return 0;
  }
}

// =========================
// 🔥 SHARES TOTALES (TODOS LOS POSTS)
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

      const posts = res.data.data || [];

      for (const post of posts) {
        total += post.shares?.count || 0;
      }

      url = res.data.paging?.next || null;
    }
  } catch (err) {
    console.log("SHARE ERROR:", err.message);
  }

  return total;
}

// =========================
// 💾 GUARDAR SHARE SNAPSHOT
// =========================
async function saveDailyShare(pageName, share, date) {
  const payload = {
    pagina: pageName,
    fecha: date,
    share: share ?? 0,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("acumulado_share_diarios")
    .upsert(payload, {
      onConflict: "pagina,fecha",
    });

  if (error) {
    console.log("❌ SHARE ERROR DB:", error.message);
  } else {
    console.log("✅ SHARE OK:", pageName, date, share);
  }
}

// =========================
// 🚀 MAIN (SOLO DÍA ACTUAL CUBA)
// =========================
async function main() {

  const { data: services } = await supabase.from("pages_services").select("*");
  const { data: pages } = await supabase.from("pages").select("*");
  const { data: postsProgramados } = await supabase.from("post_programados_fb").select("*");

  const day = getCubaDate();
  const nextDay = formatDate(addDays(new Date(day), 1));

  for (const service of services) {

    const page = pages.find(p => p.nombre === service.Nombre_pagina);
    if (!page) continue;

    const pageId = page.id_page;
    const token = page.token;

    if (!pageId || !token) continue;

    try {

      // =========================
      // 📊 METRICS DEL DÍA
      // =========================
      const impresiones = await getMetric(pageId, token, "page_impressions_unique", day, nextDay);
      const reactions = await getMetric(pageId, token, "page_actions_post_reactions_like_total", day, nextDay);
      const engagement = await getMetric(pageId, token, "page_post_engagements", day, nextDay);

      // =========================
      // 🔥 SHARES ACUMULADOS TOTALES
      // =========================
      const share = await getTotalShares(pageId, token);

      // =========================
      // 🧠 POSTS PROGRAMADOS
      // =========================
      const post = postsProgramados
        .filter(p =>
          p.pagina === service.Nombre_pagina &&
          new Date(p.fecha_inicio) <= new Date(day) &&
          (!p.fecha_final || new Date(p.fecha_final) >= new Date(day))
        )
        .reduce((s, p) => s + p.post_diarios, 0);

      // =========================
      // 💾 REPORTE DIARIO
      // =========================
      await supabase.from("reporte_diario").upsert({
        pagina: service.Nombre_pagina,
        fecha: day,
        impresiones,
        reaction: reactions,
        engagement,
        post,
        share,
        engagement_real: engagement,
      }, {
        onConflict: "pagina,fecha",
      });

      // =========================
      // 📊 SHARE SNAPSHOT DIARIO
      // =========================
      await saveDailyShare(service.Nombre_pagina, share, day);

      console.log(`📊 OK ${service.Nombre_pagina} ${day}`);

    } catch (err) {
      console.log(`❌ ERROR ${service.Nombre_pagina}:`, err.message);
    }
  }
}

main();
