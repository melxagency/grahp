const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// =========================
// 📅 HELPERS
// =========================
const formatDate = (d) =>
  new Date(d).toISOString().split("T")[0];

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

// =========================
// 🔹 METRICS
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
// 🔹 SHARES (POSTS)
// =========================
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
  } catch {
    return 0;
  }

  return total;
}

// =========================
// 🔥 GUARDAR SHARE DIARIO
// =========================
async function saveDailyShare(pageName, share, date) {
  await supabase.from("acumulado_share_diarios").upsert(
    {
      pagina: pageName,
      fecha: date,
      share: share,
      created_at: new Date().toISOString(),
    },
    {
      onConflict: "pagina,fecha",
    }
  );
}

// =========================
// 🚀 MAIN
// =========================
async function main() {

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
    const endDate = service.fecha_termino_explotacion
      ? new Date(service.fecha_termino_explotacion)
      : new Date();

    for (let d = new Date(startDate); d <= endDate; d = addDays(d, 1)) {

      const day = formatDate(d);
      const nextDay = formatDate(addDays(d, 1));

      try {

        // =========================
        // 📊 METRICS
        // =========================
        const impresiones = await getMetric(pageId, token, "page_impressions_unique", day, nextDay);
        const reactions = await getMetric(pageId, token, "page_actions_post_reactions_like_total", day, nextDay);
        const engagement = await getMetric(pageId, token, "page_post_engagements", day, nextDay);

        const share = await getSharesByDay(pageId, token, day, nextDay);

        // =========================
        // 🧠 POSTS PROGRAMADOS
        // =========================
        const post = postsProgramados
          .filter(p =>
            p.pagina === service.Nombre_pagina &&
            new Date(p.fecha_inicio) <= d &&
            (!p.fecha_final || new Date(p.fecha_final) >= d)
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
        // 📊 SHARE ACUMULADO DIARIO (NUEVO)
        // =========================
        await saveDailyShare(service.Nombre_pagina, share, day);

        console.log(`📊 OK ${service.Nombre_pagina} ${day}`);

      } catch (err) {
        console.error(`❌ Error ${service.Nombre_pagina} ${day}:`, err.message);
      }
    }
  }
}

main();
