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
  return new Date(now.getTime() + cubaOffsetMs)
    .toISOString()
    .split("T")[0];
}

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const formatDate = (d) => d.toISOString().split("T")[0];

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
  } catch {
    return 0;
  }
}

// =========================
// 🔥 SHARE TOTAL
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
// 🔥 SHARE AYER
// =========================
async function getYesterdayShare(pagina, fecha) {
  const prev = new Date(fecha);
  prev.setDate(prev.getDate() - 1);

  const prevDate = formatDate(prev);

  const { data } = await supabase
    .from("acumulado_share_diarios")
    .select("share")
    .eq("pagina", pagina)
    .eq("fecha", prevDate)
    .maybeSingle();

  return data?.share || 0;
}

// =========================
// 🚀 MAIN
// =========================
async function main() {

  const { data: services } = await supabase.from("pages_services").select("*");
  const { data: pages } = await supabase.from("pages").select("*");
  const { data: postsProgramados } = await supabase.from("post_programados_fb").select("*");

  const today = new Date(getCubaDate());

  for (const service of services) {

    const page = pages.find(p => p.nombre === service.Nombre_pagina);
    if (!page) continue;

    const pageId = page.id_page;
    const token = page.token;

    if (!pageId || !token) continue;

    const startDate = new Date(service.fecha_inicio_explotacion);
    const endDate = today;

    // 🔥 BUSCAR ÚLTIMO DÍA REGISTRADO
    const { data: existing } = await supabase
      .from("reporte_diario")
      .select("fecha")
      .eq("pagina", service.Nombre_pagina);

    const existingSet = new Set((existing || []).map(e => e.fecha));

    // =========================
    // 🔁 LOOP DÍAS FALTANTES
    // =========================
    for (let d = new Date(startDate); d <= endDate; d = addDays(d, 1)) {

      const day = formatDate(d);
      const nextDay = formatDate(addDays(d, 1));

      // 👉 solo días faltantes
      if (existingSet.has(day)) continue;

      try {

        const impresiones = await getMetric(pageId, token, "page_impressions_unique", day, nextDay);
        const reactions = await getMetric(pageId, token, "page_actions_post_reactions_like_total", day, nextDay);
        const engagement = await getMetric(pageId, token, "page_post_engagements", day, nextDay);

        const post = postsProgramados
          .filter(p =>
            p.pagina === service.Nombre_pagina &&
            new Date(p.fecha_inicio) <= d &&
            (!p.fecha_final || new Date(p.fecha_final) >= d)
          )
          .reduce((s, p) => s + p.post_diarios, 0);

        const share_acumulado = await getTotalShares(pageId, token);
        const share_ayer = await getYesterdayShare(service.Nombre_pagina, day);
        const share_diario = Math.max(share_acumulado - share_ayer, 0);

        await supabase.from("reporte_diario").upsert({
          pagina: service.Nombre_pagina,
          fecha: day,
          impresiones,
          reaction: reactions,
          engagement,
          post,
          engagement_real: engagement,
          share: share_diario
        }, {
          onConflict: "pagina,fecha",
        });

        console.log(`📊 OK ${service.Nombre_pagina} ${day}`);

      } catch (err) {
        console.log(`ERROR ${service.Nombre_pagina}:`, err.message);
      }
    }
  }
}

main();
