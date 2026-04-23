const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 📅 formatear fecha
function formatDate(d) {
  return new Date(d).toISOString().split("T")[0];
}

// 🔹 INSIGHTS STABLE
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
    console.error(
      `❌ INSIGHT ERROR (${metric})`,
      err.response?.data || err.message
    );
    return 0;
  }
}

async function main() {

  // 📦 servicios activos
  const { data: services, error: err1 } = await supabase
    .from("pages_services")
    .select("*");

  if (err1) {
    console.error("Supabase services error:", err1);
    return;
  }

  // 📦 páginas con credenciales
  const { data: pages, error: err2 } = await supabase
    .from("pages")
    .select("*");

  if (err2) {
    console.error("Supabase pages error:", err2);
    return;
  }

  for (const service of services) {

    // 🔥 match por nombre
    const page = pages.find(
      (p) => p.nombre === service.Nombre_pagina
    );

    if (!page) {
      console.log("❌ No existe page:", service.Nombre_pagina);
      continue;
    }

    const pageId = page.id_page;
    const token = page.token;

    if (!pageId || !token) {
      console.log("❌ Página incompleta:", service.Nombre_pagina);
      continue;
    }

    // 📅 rango fechas
    const startDate = new Date(service.fecha_inicio_explotacion);
    const endDate = service.fecha_termino_explotacion
      ? new Date(service.fecha_termino_explotacion)
      : new Date();

    // 🔁 loop diario
    for (
      let d = new Date(startDate);
      d <= endDate;
      d.setDate(d.getDate() + 1)
    ) {
      const day = formatDate(d);

      try {
        // 📊 métricas
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

        // 🔁 UPSERT (CLAVE DEL SISTEMA)
        const { error } = await supabase
          .from("reporte_diario")
          .upsert(
            {
              pagina: service.Nombre_pagina,
              fecha: day,
              impresiones: impressions,
              reaction: reactions,
              engagement: engagement,
              share: 0,
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
