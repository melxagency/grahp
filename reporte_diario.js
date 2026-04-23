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

// 🔹 META INSIGHTS SAFE
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

    return values.reduce(
      (sum, d) => sum + (d.value || 0),
      0
    );

  } catch (err) {
    console.error("INSIGHT ERROR:", metric, err.response?.data || err.message);
    return 0; // 🔥 IMPORTANTE
  }
}

// 🔹 SHARES SAFE
async function getSharesByDay(pageId, token, since, until) {
  let url = `https://graph.facebook.com/v19.0/${pageId}/posts`;
  let totalShares = 0;

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

      const posts = res.data.data || [];

      for (const post of posts) {
        totalShares += post.shares?.count || 0;
      }

      url = res.data.paging?.next || null;
    }
  } catch (err) {
    console.error("SHARE ERROR:", err.response?.data || err.message);
  }

  return totalShares;
}

function calculatePosts(posts, pageName, date) {
  return posts
    .filter((p) =>
      p.pagina === pageName &&
      new Date(p.fecha_inicio) <= date &&
      (!p.fecha_final || new Date(p.fecha_final) >= date)
    )
    .reduce((sum, p) => sum + p.post_diarios, 0);
}

async function main() {

  const { data: services } = await supabase
    .from("pages_services")
    .select("*");

  const { data: pages } = await supabase
    .from("pages")
    .select("*");

  const { data: postsProgramados } = await supabase
    .from("post_programados_fb")
    .select("*");

  for (const service of services) {

    const page = pages.find(
      (p) => p.nombre === service.Nombre_pagina
    );

    if (!page) continue;

    const pageId = page.id_page;
    const token = page.token;

    if (!pageId || !token) continue;

    const startDate = new Date(service.fecha_inicio_explotacion);
    const endDate = service.fecha_termino_explotacion
      ? new Date(service.fecha_termino_explotacion)
      : new Date();

    for (
      let d = new Date(startDate);
      d <= endDate;
      d = addDays(d, 1)
    ) {

      const day = formatDate(d);
      const nextDay = formatDate(addDays(d, 1));

      // 🔥 SIEMPRE DEFINIDAS (FIX)
      let impresiones = 0;
      let reactions = 0;
      let engagement = 0;

      try {

        impresiones = await getMetric(
          pageId,
          token,
          "page_impressions_unique",
          day,
          nextDay
        ) || 0;

        reactions = await getMetric(
          pageId,
          token,
          "page_actions_post_reactions_like_total",
          day,
          nextDay
        ) || 0;

        engagement = await getMetric(
          pageId,
          token,
          "page_post_engagements",
          day,
          nextDay
        ) || 0;

        const post = calculatePosts(
          postsProgramados,
          service.Nombre_pagina,
          d
        );

        const share = await getSharesByDay(
          pageId,
          token,
          day,
          nextDay
        ) || 0;

        await supabase.from("reporte_diario").upsert(
          {
            pagina: service.Nombre_pagina,
            fecha: day,
            impresiones,
            reaction: reactions,
            engagement,
            post,
            share,
            engagement_real: engagement,
          },
          {
            onConflict: "pagina,fecha",
          }
        );

        console.log(`📊 OK ${service.Nombre_pagina} ${day}`);

      } catch (err) {
        console.error(
          `❌ Error ${service.Nombre_pagina} ${day}:`,
          err.message
        );
      }
    }
  }
}

main();
