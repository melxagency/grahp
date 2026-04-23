const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 📅 helpers
function formatDate(d) {
  return new Date(d).toISOString().split("T")[0];
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// 🔹 INSIGHTS META
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
    return values.reduce((sum, d) => sum + (d.value || 0), 0);
  } catch (err) {
    console.error("INSIGHT ERROR:", metric, err.response?.data || err.message);
    return 0;
  }
}

// 🔹 SHARES POR POSTS DEL DÍA
async function getSharesByDay(pageId, token, since, until) {
  let url = `https://graph.facebook.com/v19.0/${pageId}/posts`;
  let totalShares = 0;

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

  return totalShares;
}

// 🔥 POSTS PROGRAMADOS ACTIVOS
function calculatePosts(posts, pageName, date) {
  return posts
    .filter((p) => {
      return (
        p.pagina === pageName &&
        new Date(p.fecha_inicio) <= date &&
        (!p.fecha_final || new Date(p.fecha_final) >= date)
      );
    })
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
      const nextDay = formatDate(addDays(d, 1)); // 🔥 FIX CLAVE

      try {

        // 📊 INSIGHTS CORRECTOS
        const impressions = await getMetric(
          pageId,
          token,
          "page_impressions_unique",
          day,
          nextDay
        );

        const reactions = await getMetric(
          pageId,
          token,
          "page_actions_post_reactions_like_total",
          day,
          nextDay
        );

        const engagement = await getMetric(
          pageId,
          token,
          "page_post_engagements",
          day,
          nextDay
        );

        // 🔥 POSTS PROGRAMADOS
        const post = calculatePosts(
          postsProgramados,
          service.Nombre_pagina,
          d
        );

        // 🔥 SHARES DEL DÍA
        const share = await getSharesByDay(
          pageId,
          token,
          day,
          nextDay
        );

        // 💾 UPSERT FINAL
        const { error } = await supabase
          .from("reporte_diario")
          .upsert(
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

        if (error) {
          console.error("UPSERT ERROR:", error);
        } else {
          console.log(`📊 OK ${service.Nombre_pagina} ${day}`);
        }

      } catch (err) {
        console.error(
          `❌ Error ${service.Nombre_pagina} ${day}:`,
          err.response?.data || err.message
        );
      }
    }
  }
}

main();
