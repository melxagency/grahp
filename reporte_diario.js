const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const ws = require("ws");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  {
    realtime: { transport: ws },
  }
);

function getTodayCuba() {
  const now = new Date();
  return new Date(now.getTime() + (-5 * 60 * 60 * 1000)).toISOString().split("T")[0];
}

function getYesterdayCuba() {
  const now = new Date();
  const cuba = new Date(now.getTime() + (-5 * 60 * 60 * 1000));
  cuba.setDate(cuba.getDate() - 1);
  return cuba.toISOString().split("T")[0];
}

function nextDay(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split("T")[0];
}

function prevDay(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0];
}

function generateDays(start, end) {
  const days = [];
  const current = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  while (current <= last) {
    days.push(current.toISOString().split("T")[0]);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getMetric(pageId, token, metric, since, until, period = "day", retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(
        `https://graph.facebook.com/v21.0/${pageId}/insights`,
        { params: { metric, period, since, until, access_token: token } }
      );
      const values = res.data.data?.[0]?.values || [];
      return values.reduce((sum, v) => {
        if (typeof v.value === "object" && v.value !== null) {
          return sum + Object.values(v.value).reduce((s, n) => s + (Number(n) || 0), 0);
        }
        return sum + (Number(v.value) || 0);
      }, 0);
    } catch (err) {
      const isTransient = err.response?.data?.error?.is_transient;
      const msg = err.response?.data?.error?.message || err.message;
      if (isTransient && attempt < retries) {
        await sleep(attempt * 3000);
      } else {
        console.log(`❌ METRIC ERROR ${metric}:`, msg);
        return 0;
      }
    }
  }
  return 0;
}

async function getDays28(pageId, token, day, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(
        `https://graph.facebook.com/v21.0/${pageId}/insights`,
        {
          params: {
            metric: "page_impressions_unique",
            period: "days_28",
            since: day,
            until: nextDay(day),
            access_token: token,
          },
        }
      );
      const values = res.data.data?.[0]?.values || [];
      return values[0]?.value || 0;
    } catch (err) {
      const isTransient = err.response?.data?.error?.is_transient;
      const msg = err.response?.data?.error?.message || err.message;
      if (isTransient && attempt < retries) {
        await sleep(attempt * 3000);
      } else {
        console.log(`❌ DAYS28 ERROR:`, msg);
        return 0;
      }
    }
  }
  return 0;
}

async function getReactions(pageId, token, since, until, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(
        `https://graph.facebook.com/v21.0/${pageId}/insights`,
        {
          params: {
            metric: "page_actions_post_reactions_total",
            period: "day",
            since,
            until,
            access_token: token,
          },
        }
      );
      const values = res.data.data?.[0]?.values || [];
      return values.reduce((sum, v) => {
        if (typeof v.value === "object" && v.value !== null) {
          return sum + Object.values(v.value).reduce((s, n) => s + (Number(n) || 0), 0);
        }
        return sum + (Number(v.value) || 0);
      }, 0);
    } catch (err) {
      const isTransient = err.response?.data?.error?.is_transient;
      const msg = err.response?.data?.error?.message || err.message;
      if (isTransient && attempt < retries) {
        await sleep(attempt * 3000);
      } else {
        console.log(`❌ REACTIONS ERROR:`, msg);
        return 0;
      }
    }
  }
  return 0;
}

// ✅ Acumulado de TODOS los posts de la página
async function getAcumuladoTodosLosPosts(pageId, token) {
  let url = `https://graph.facebook.com/v21.0/${pageId}/posts`;
  let totalShare = 0;
  let totalImpresiones = 0;
  let totalImpresionesUnicas = 0;
  let totalReactions = 0;
  let totalEngagement = 0;
  let totalPosts = 0;

  try {
    const posts = [];
    while (url) {
      const res = await axios.get(url, {
        params: { fields: "id,shares", limit: 100, access_token: token },
      });
      for (const post of res.data?.data || []) {
        posts.push(post.id);
        totalShare += post.shares?.count || 0;
      }
      url = res.data?.paging?.next || null;
    }

    totalPosts = posts.length;
    console.log(`📝 Total posts página: ${totalPosts}`);

    for (const postId of posts) {
      try {
        const res = await axios.get(
          `https://graph.facebook.com/v21.0/${postId}/insights`,
          {
            params: {
              metric: "post_media_view,post_impressions_unique,post_reactions_by_type_total,post_engaged_users",
              access_token: token,
            },
          }
        );
        for (const metric of res.data?.data || []) {
          const value = metric.values?.[0]?.value || 0;
          if (metric.name === "post_media_view") totalImpresiones += Number(value) || 0;
          if (metric.name === "post_impressions_unique") totalImpresionesUnicas += Number(value) || 0;
          if (metric.name === "post_reactions_by_type_total") {
            totalReactions += typeof value === "object"
              ? Object.values(value).reduce((s, n) => s + (Number(n) || 0), 0)
              : Number(value) || 0;
          }
          if (metric.name === "post_engaged_users") totalEngagement += Number(value) || 0;
        }
        await sleep(100);
      } catch { /* silencioso */ }
    }
  } catch (err) {
    console.log("❌ ACUMULADO TODOS POSTS ERROR:", err.response?.data?.error?.message || err.message);
  }

  const frecuencia = totalImpresionesUnicas > 0
    ? Math.round((totalImpresiones / totalImpresionesUnicas) * 100) / 100
    : 0;

  return { totalShare, totalImpresiones, totalImpresionesUnicas, frecuencia, totalReactions, totalEngagement, totalPosts };
}

// ✅ Acumulado solo de posts en comercial_post_community_paginas con activo=true
async function getAcumuladoPostsComunidad(dbPageId, token) {
  const { data: posts } = await supabase
    .from("comercial_post_community_paginas")
    .select("post_id")
    .eq("pagina", dbPageId)
    .eq("activo", true);

  if (!posts?.length) return {
    totalAutoPost: 0, totalImpresiones: 0, totalImpresionesUnicas: 0,
    frecuencia: 0, totalReactions: 0, totalEngagement: 0,
  };

  let totalAutoPost = posts.length;
  let totalImpresiones = 0;
  let totalImpresionesUnicas = 0;
  let totalReactions = 0;
  let totalEngagement = 0;

  for (const post of posts) {
    try {
      const res = await axios.get(
        `https://graph.facebook.com/v21.0/${post.post_id}/insights`,
        {
          params: {
            metric: "post_media_view,post_impressions_unique,post_reactions_by_type_total,post_engaged_users",
            access_token: token,
          },
        }
      );
      for (const metric of res.data?.data || []) {
        const value = metric.values?.[0]?.value || 0;
        if (metric.name === "post_media_view") totalImpresiones += Number(value) || 0;
        if (metric.name === "post_impressions_unique") totalImpresionesUnicas += Number(value) || 0;
        if (metric.name === "post_reactions_by_type_total") {
          totalReactions += typeof value === "object"
            ? Object.values(value).reduce((s, n) => s + (Number(n) || 0), 0)
            : Number(value) || 0;
        }
        if (metric.name === "post_engaged_users") totalEngagement += Number(value) || 0;
      }
      await sleep(100);
    } catch { /* silencioso */ }
  }

  const frecuencia = totalImpresionesUnicas > 0
    ? Math.round((totalImpresiones / totalImpresionesUnicas) * 100) / 100
    : 0;

  return { totalAutoPost, totalImpresiones, totalImpresionesUnicas, frecuencia, totalReactions, totalEngagement };
}

async function main() {
  const { data: pages, error: pagesError } = await supabase
    .from("community_paginas")
    .select("*")
    .eq("clasificacion", 1)
    .eq("red_social", 2);

  if (pagesError || !pages?.length) {
    console.log("❌ Error cargando páginas:", pagesError);
    return;
  }

  console.log(`📄 Páginas encontradas: ${pages.length}`);

  const { data: contratos, error: contratosError } = await supabase
    .from("contratos_servicios")
    .select("fecha_inicio")
    .order("fecha_inicio", { ascending: true })
    .limit(1);

  if (contratosError || !contratos?.length) {
    console.log("❌ Error cargando contratos:", contratosError);
    return;
  }

  const startDate = contratos[0].fecha_inicio.split("T")[0];
  const yesterday = getYesterdayCuba();
  const hoy = getTodayCuba();
  const allDays = generateDays(startDate, yesterday);

  console.log(`📅 Rango total: ${startDate} → ${yesterday} (${allDays.length} días)`);

  for (const page of pages) {
    const fbId = page.id_page;
    const dbId = page.id;
    const token = page.token;

    if (!fbId || !token) {
      console.warn(`⚠️ Página ${dbId} sin id_page o token, saltando...`);
      continue;
    }

    const { data: registros } = await supabase
      .from("insights_reporte_diario")
      .select("fecha")
      .eq("pagina", dbId);

    const fechasRegistradas = new Set((registros || []).map((r) => r.fecha));
    const diasFaltantes = allDays.filter((d) => !fechasRegistradas.has(d));

    if (!diasFaltantes.length) {
      console.log(`✅ Página ${dbId} completa, sin días faltantes`);
      continue;
    }

    console.log(`📊 Página ${dbId}: ${diasFaltantes.length} días faltantes`);

    // ✅ 1. Guardar acumulado TODOS los posts en insights_acumulado_share
    const { data: acumuladoShareHoy } = await supabase
      .from("insights_acumulado_share")
      .select("id_record")
      .eq("id_pagina", dbId)
      .eq("fecha", hoy)
      .maybeSingle();

    if (!acumuladoShareHoy) {
      const acShare = await getAcumuladoTodosLosPosts(fbId, token);
      await sleep(500);
      const days28Hoy = await getDays28(fbId, token, hoy);
      await sleep(300);

      await supabase.from("insights_acumulado_share").insert({
        id_pagina: dbId,
        fecha: hoy,
        share: acShare.totalShare,
        impresiones: acShare.totalImpresiones,
        impresiones_unicas: acShare.totalImpresionesUnicas,
        frecuencia: acShare.frecuencia,
        reactions: acShare.totalReactions,
        engagement: acShare.totalEngagement,
        impresiones_days_28: days28Hoy,
      });
      console.log(`📦 insights_acumulado_share guardado: página ${dbId} → ${hoy}`);
    }

    // ✅ 2. Guardar acumulado posts comunidad en insights_acumulado_post_community_paginas
    const { data: acumuladoPostComHoy } = await supabase
      .from("insights_acumulado_post_community_paginas")
      .select("id")
      .eq("id_pagina", dbId)
      .eq("fecha", hoy)
      .maybeSingle();

    if (!acumuladoPostComHoy) {
      const acPostCom = await getAcumuladoPostsComunidad(dbId, token);
      await sleep(500);
      const days28PostCom = await getDays28(fbId, token, hoy);
      await sleep(300);

      await supabase.from("insights_acumulado_post_community_paginas").insert({
        id_pagina: dbId,
        fecha: hoy,
        total_auto_post: acPostCom.totalAutoPost,
        impresiones: acPostCom.totalImpresiones,
        impresiones_unicas: acPostCom.totalImpresionesUnicas,
        frecuencia: acPostCom.frecuencia,
        reactions: acPostCom.totalReactions,
        engagement: acPostCom.totalEngagement,
        impresiones_days_28: days28PostCom,
      });
      console.log(`📦 insights_acumulado_post_community_paginas guardado: página ${dbId} → ${hoy}`);
    }

    for (const day of diasFaltantes) {
      const until = nextDay(day);
      const dayPrev = prevDay(day);
      const dayMinus29 = (() => {
        const d = new Date(day + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - 27);
        return d.toISOString().split("T")[0];
      })();
      const dayMinus30 = (() => {
        const d = new Date(day + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - 28);
        return d.toISOString().split("T")[0];
      })();

      // ✅ Métricas totales del día
      const impresiones = await getMetric(fbId, token, "page_media_view", day, until);
      await sleep(300);
      const impresiones_unicas = await getMetric(fbId, token, "page_impressions_unique", day, until);
      await sleep(300);
      const vistas_perfil = await getMetric(fbId, token, "page_views_total", day, until);
      await sleep(300);
      const reactions = await getReactions(fbId, token, day, until);
      await sleep(300);
      const engagement = await getMetric(fbId, token, "page_post_engagements", day, until);
      await sleep(300);

      const days28Hoy = await getDays28(fbId, token, day);
      await sleep(300);
      const days28Ayer = await getDays28(fbId, token, dayPrev);
      await sleep(300);

      const uniquePrimerDia = await getMetric(fbId, token, "page_impressions_unique", dayMinus29, nextDay(dayMinus29));
      await sleep(300);
      const uniqueDiaAntesPrimerDia = await getMetric(fbId, token, "page_impressions_unique", dayMinus30, nextDay(dayMinus30));
      await sleep(300);
      const uniqueAyer = await getMetric(fbId, token, "page_impressions_unique", dayPrev, day);
      await sleep(300);

      const impresiones_days_28 = days28Hoy;
      const diffDays28 = days28Hoy - days28Ayer;
      const diffPrimerDia = uniquePrimerDia - uniqueDiaAntesPrimerDia;
      const diffUltimoDia = impresiones_unicas - uniqueAyer;
      const estimado_impresiones_unicas_acumuladas = Math.max(0, diffDays28 - diffPrimerDia + diffUltimoDia);

      // ✅ Share del día = diferencia diaria de insights_acumulado_share
      const { data: acShareDia } = await supabase
        .from("insights_acumulado_share")
        .select("share, impresiones, impresiones_unicas, reactions, engagement")
        .eq("id_pagina", dbId)
        .eq("fecha", day)
        .maybeSingle();

      const { data: acShareDiaAnterior } = await supabase
        .from("insights_acumulado_share")
        .select("share, impresiones, impresiones_unicas, reactions, engagement")
        .eq("id_pagina", dbId)
        .eq("fecha", dayPrev)
        .maybeSingle();

      let share = 0;
      let impresiones_auto = impresiones;
      let impresiones_unicas_auto = impresiones_unicas;
      let reactions_auto = reactions;
      let engagement_auto = engagement;

      if (acShareDia && acShareDiaAnterior) {
        // Share del día
        share = Math.max(0, acShareDia.share - acShareDiaAnterior.share);

        // Diferencia diaria del acumulado share
        const diffImpShare = Math.max(0, acShareDia.impresiones - acShareDiaAnterior.impresiones);
        const diffImpUnicasShare = Math.max(0, acShareDia.impresiones_unicas - acShareDiaAnterior.impresiones_unicas);
        const diffReactionsShare = Math.max(0, acShareDia.reactions - acShareDiaAnterior.reactions);
        const diffEngagementShare = Math.max(0, acShareDia.engagement - acShareDiaAnterior.engagement);

        // ✅ Insights automáticos = total del día - diferencia diaria del acumulado share
        impresiones_auto = Math.max(0, impresiones - diffImpShare);
        impresiones_unicas_auto = Math.max(0, impresiones_unicas - diffImpUnicasShare);
        reactions_auto = Math.max(0, reactions - diffReactionsShare);
        engagement_auto = Math.max(0, engagement - diffEngagementShare);
      }

      // ✅ Guardar en insights_diario_groups_auto_post
      const { data: diarioAutoExiste } = await supabase
        .from("insights_diario_groups_auto_post")
        .select("id")
        .eq("id_pagina", dbId)
        .eq("fecha", day)
        .maybeSingle();

      if (!diarioAutoExiste) {
        const frecuenciaAuto = impresiones_unicas_auto > 0
          ? Math.round((impresiones_auto / impresiones_unicas_auto) * 100) / 100
          : 0;

        await supabase.from("insights_diario_groups_auto_post").insert({
          id_pagina: dbId,
          fecha: day,
          total_auto_post: share,
          impresiones: impresiones_auto,
          impresiones_unicas: impresiones_unicas_auto,
          frecuencia: frecuenciaAuto,
          reactions: reactions_auto,
          engagement: engagement_auto,
          impresiones_days_28: impresiones_days_28,
        });
        console.log(`📊 insights_diario_groups_auto_post guardado: página ${dbId} → ${day}`);
      }

      await sleep(300);

      console.log(`📈 ${dbId} → ${day}`, {
        impresiones,
        impresiones_unicas,
        vistas_perfil,
        reactions,
        share,
        engagement,
        impresiones_days_28,
        estimado_impresiones_unicas_acumuladas,
        impresiones_auto,
        impresiones_unicas_auto,
        reactions_auto,
        engagement_auto,
      });

      const { error } = await supabase.from("insights_reporte_diario").insert({
        pagina: dbId,
        impresiones,
        impresiones_unicas,
        vistas_perfil,
        reaction: reactions,
        share,
        engagement,
        impresiones_days_28,
        estimado_impresiones_unicas_acumuladas,
        impresiones_post_share: impresiones_auto,
        impresiones_unicas_post_share: impresiones_unicas_auto,
        fecha: day,
        created_at: new Date().toISOString(),
      });

      if (error) {
        console.log(`❌ INSERT ERROR ${dbId} → ${day}:`, error.message);
      } else {
        console.log(`✅ OK ${dbId} → ${day}`);
      }
    }
  }

  console.log("🎉 Completado.");
}

main();
