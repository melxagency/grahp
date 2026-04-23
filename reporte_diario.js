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

// 🔹 INSIGHTS
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
    console.error("INSIGHT ERROR:", err.response?.data || err.message);
    return 0;
  }
}

async function main() {

  // 📦 servicios
  const { data: services } = await supabase
    .from("pages_services")
    .select("*");

  // 📦 páginas
  const { data: pages } = await supabase
    .from("pages")
    .select("*");

  for (const service of services) {

    const page = pages.find(
      (p) => p.nombre === service.Nombre_pagina
    );

    if (!page) continue;

    const pageId = page.id_page;
    const token = page.token;

    if (!pageId || !token) continue;

    // 📅 rango
    const startDate = new Date(service.fecha_inicio_explotacion);
    const endDate = service.fecha_termino_explotacion
      ? new Date(service.fecha_termino_explotacion)
      : new Date();

    // 📥 traer lo que YA existe
    const { data: existing } = await supabase
      .from("reporte_diario")
      .select("fecha")
      .eq("pagina", service.Nombre_pagina);

    const existingSet = new Set(
      (existing || []).map((r) => r.fecha)
    );

    // 🔁 recorrer solo huecos
    for (
      let d = new Date(startDate);
      d <= endDate;
      d = addDays(d, 1)
    ) {
      const day = formatDate(d);

      // 🚫 si ya existe, skip
      if (existingSet.has(day)) continue;

      try {

        const impressions = await getMetric(
          pageId,
          token,
          "page_impressions_unique",
          day,
          day
        );

        const reactions = await getMetric(
          pageId,
          token,
          "page_actions_post_reactions_like_total",
          day,
          day
        );

        const engagement = await getMetric(
          pageId,
          token,
          "page_post_engagements",
          day,
          day
        );

        await supabase.from("reporte_diario").insert({
          pagina: service.Nombre_pagina,
          fecha: day,
          impresiones: impressions,
          reaction: reactions,
          engagement: engagement,
          share: 0,
          engagement_real: engagement,
        });

        console.log(`➕ FILL ${service.Nombre_pagina} ${day}`);

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
