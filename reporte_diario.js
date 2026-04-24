const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 📅 helpers
const formatDate = (d) =>
  new Date(d).toISOString().split("T")[0];

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

// 🔹 METRICS
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

// 🔹 SHARES
async function getSharesByDay(pageId, token, since, until) {
  let url = `https://graph.facebook.com/v19.0/${pageId}/posts`;
  let total = 0;

  try {
    while (url) {
      const res = await axios.get(url, {
        params: {
          fields: "shares,created_time",
          since,
          until,
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

async function main() {

  // 🇨🇺 Hora actual en Cuba
  const now = new Date();
  const cubaOffset = -4 * 60;
  const cubaTime = new Date(now.getTime() + cubaOffset * 60000);

  // 🔥 Ayer en Cuba
  const yesterdayCuba = new Date(cubaTime);
  yesterdayCuba.setDate(yesterdayCuba.getDate() - 1);

  console.log("🗓 Cuba hoy:", formatDate(cubaTime));
  console.log("🗓 Procesando hasta:", formatDate(yesterdayCuba));

  const { data: services } = await supabase.from("pages_services").select("*");
  const { data: pages } = await supabase.from("pages").select("*");
  const { data: postsProgramados } = await supabase.from("post_programados_fb").select("*");

  for (const service of services) {

    const page = pages.find(p => p.nombre === service.Nombre_pagina);
    if (!page) continue;

    const pageId = page.id_page;
    const token = page.token;

    if (!pageId || !token) continue;

    const startDate = new Date(service.fecha_inicio_explotacion);

    // 🔥 END DATE CORREGIDO (NUNCA HOY)
    let endDate = service.fecha_termino_explotacion
      ? new Date(service.fecha_termino_explotacion)
      : yesterdayCuba;

    if (endDate > yesterdayCuba) {
      endDate = new Date(yesterdayCuba);
    }

    // 🔥 Fechas existentes
    const { data: existing } = await supabase
      .from("reporte_diario")
      .select("fecha")
      .eq("pagina", service.Nombre_pagina);

    const existingSet = new Set(
      (existing || []).map(r => r.fecha)
    );

    // 🔥 LOOP DÍAS
    for (let d = new Date(startDate); d <= endDate; d = addDays(d, 1)) {

      const day = formatDate(d);
      const nextDay = formatDate(addDays(d, 1));

      // 🔥 NUNCA HOY
      if (day === formatDate(cubaTime)) continue;

      // 🔥 SI YA EXISTE, SKIP
      if (existingSet.has(day)) continue;

      try {

        const impresiones = await getMetric(pageId, token, "page_impressions_unique", day, nextDay);
        const reactions = await getMetric(pageId, token, "page_actions_post_reactions_like_total", day, nextDay);
        const engagement = await getMetric(pageId, token, "page_post_engagements", day, nextDay);
        const share = await getSharesByDay(pageId, token, day, nextDay);

        const post = postsProgramados
          .filter(p =>
            p.pagina === service.Nombre_pagina &&
            new Date(p.fecha_inicio) <= d &&
            (!p.fecha_final || new Date(p.fecha_final) >= d)
          )
          .reduce((s, p) => s + p.post_diarios, 0);

        await supabase.from("reporte_diario").insert({
          pagina: service.Nombre_pagina,
          fecha: day,
          impresiones,
          reaction: reactions,
          engagement,
          post,
          share,
          engagement_real: engagement,
        });

        console.log(`📊 NUEVO ${service.Nombre_pagina} ${day}`);

      } catch (err) {
        console.error(`❌ Error ${service.Nombre_pagina} ${day}:`, err.message);
      }
    }
  }
}

main();
