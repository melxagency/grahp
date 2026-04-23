const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 📅 HOY (día único)
const today = new Date().toISOString().split("T")[0];

// 🔧 INSIGHTS (seguro y estable)
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
    return 0;
  }
}

// 🚀 MAIN
async function main() {
  const { data: services, error } = await supabase
    .from("pages_services")
    .select("*");

  if (error) {
    console.error("Supabase error:", error);
    return;
  }

  for (const service of services) {

    // 🧨 VALIDACIÓN CRÍTICA
    if (!service.id_page || !service.token_page) {
      console.log("❌ Página incompleta:", service);
      continue;
    }

    const pageId = service.id_page;
    const token = service.token_page;

    try {
      // 📊 SOLO DÍA ACTUAL
      const impressions = await getMetric(
        pageId,
        token,
        "page_impressions_unique",
        today,
        today
      );

      const reactions = await getMetric(
        pageId,
        token,
        "page_actions_post_reactions_like_total",
        today,
        today
      );

      const engagement = await getMetric(
        pageId,
        token,
        "page_post_engagements",
        today,
        today
      );

      // 🔥 SIN POSTS (evita errores de Graph API)
      const shares = 0;

      console.log(`📊 ${service.Nombre_pagina}`, {
        impressions,
        reactions,
        engagement,
        shares,
      });

      // 💾 INSERT EN REPORTE DIARIO
      const { error: insertError } = await supabase
        .from("reporte_diario")
        .insert({
          pagina: service.Nombre_pagina,
          impresiones: impressions,
          reaction: reactions,
          engagement: engagement,
          share: shares,
          engagement_real: engagement,
          fecha: today,
        });

      if (insertError) {
        console.error("INSERT ERROR:", insertError);
      }

    } catch (err) {
      console.error(
        `Error en ${service.Nombre_pagina}:`,
        err.response?.data || err.message
      );
    }
  }
}

main();
