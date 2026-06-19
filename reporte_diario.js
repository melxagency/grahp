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
            metric: "page_total_media_view_unique",
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
    console.log(`📝 Total posts página ${pageId}: ${totalPosts}`);

    for (const postId of posts) {
      try {
        const res1 = await axios.get(
          `https://graph.facebook.com/v21.0/${postId}/insights`,
          { params: { metric: "post_media_view", access_token: token } }
        );
        for (const metric of res1.data?.data || []) {
          const value = metric.values?.[0]?.value || 0;
          if (metric.name === "post_media_view") totalImpresiones += Number(value) || 0;
        }
        await sleep(100);
      } catch (err) {
        console.log(`⚠️ Error impresiones post ${postId}:`, err.response?.data?.error?.message || err.message);
      }

      try {
        const res2 = await axios.get(
          `https://graph.facebook.com/v21.0/${postId}/insights`,
          { params: { metric: "post_engaged_users", access_token: token } }
        );
        for (const metric of res2.data?.data || []) {
          const value = metric.values?.[0]?.value || 0;
          if (metric.name === "post_engaged_users") totalEngagement += Number(value) || 0;
        }
        await sleep(100);
      } catch (err) {
        console.log(`⚠️ Error engagement post ${postId}:`, err.response?.data?.error?.message || err.message);
      }

      try {
        const res3 = await axios.get(
          `https://graph.facebook.com/v21.0/${postId}`,
          { params: { fields: "reactions.summary(true)", access_token: token } }
        );
        totalReactions += res3.data?.reactions?.summary?.total_count || 0;
        await sleep(100);
      } catch (err) {
        console.log(`⚠️ Error reactions post ${postId}:`, err.response?.data?.error?.message || err.message);
      }
    }
  } catch (err) {
    console.log("❌ ACUMULADO TODOS POSTS ERROR:", err.response?.data?.error?.message || err.message);
  }

  console.log(`📊 Acumulado página ${pageId}: imp=${totalImpresiones} react=${totalReactions} eng=${totalEngagement} shares=${totalShare}`);

  return { totalShare, totalImpresiones, totalReactions, totalEngagement, totalPosts };
}

// ✅ Acumulado solo de posts en comercial_post_community_paginas con activo=true
async function getAcumuladoPostsComunidad(dbPageId, token) {
  const { data: posts } = await supabase
    .from("comercial_post_community_paginas")
    .select("post_id")
    .eq("pagina", dbPageId)
    .eq("activo", true);

  if (!posts?.length) return {
    totalAutoPost: 0, totalImpresiones: 0, totalReactions: 0, totalEngagement: 0,
  };

  let totalAutoPost = posts.length;
  let totalImpresiones = 0;
  let totalReactions = 0;
  let totalEngagement = 0;

  for (const post of posts) {
    try {
      const res1 = await axios.get(
        `https://graph.facebook.com/v21.0/${post.post_id}/insights`,
        { params: { metric: "post_media_view", access_token: token } }
      );
      for (const metric of res1.data?.data || []) {
        const value = metric.values?.[0]?.value || 0;
        if (metric.name === "post_media_view") totalImpresiones += Number(value) || 0;
      }
      await sleep(100);
    } catch { /* silencioso */ }

    try {
      const res2 = await axios.get(
        `https://graph.facebook.com/v21.0/${post.post_id}/insights`,
        { params: { metric: "post_engaged_users", access_token: token } }
      );
      for (const metric of res2.data?.data || []) {
        const value = metric.values?.[0]?.value || 0;
        if (metric.name === "post_engaged_users") totalEngagement += Number(value) || 0;
      }
      await sleep(100);
    } catch { /* silencioso */ }

    try {
      const res3 = await axios.get(
        `https://graph.facebook.com/v21.0/${post.post_id}`,
        { params: { fields: "reactions.summary(true)", access_token: token } }
      );
      totalReactions += res3.data?.reactions?.summary?.total_count || 0;
      await sleep(100);
    } catch { /* silencioso */ }
  }

  return { totalAutoPost, totalImpresiones, totalReactions, totalEngagement };
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
    .from("comercial_contratos_servicios")
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

    // ✅ Verificar que la página es accesible antes de procesar
    try {
      await axios.get(`https://graph.facebook.com/v21.0/${fbId}`, {
        params: { fields: "id", access_token: token },
      });
    } catch (err) {
      console.log(`⚠️ Página ${dbId} (${fbId}) no accesible, saltando:`, err.response?.data?.error?.message || err.message);
      continue;
    }

    const { data: registros } = await supabase
      .from("insights_diario_groups_auto_post")
      .select("fecha")
      .eq("id_pagina", dbId);

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

      const frecuencia = days28Hoy > 0
        ? Math.round((acShare.totalImpresiones / days28Hoy) * 100) / 100
        : 0;

      await supabase.from("insights_acumulado_share").insert({
        id_pagina: dbId,
        fecha: hoy,
        share: acShare.totalShare,
        impresiones: acShare.totalImpresiones,
        impresiones_unicas: days28Hoy,
        frecuencia,
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

      const frecuenciaPostCom = days28PostCom > 0
        ? Math.round((acPostCom.totalImpresiones / days28PostCom) * 100) / 100
        : 0;

      await supabase.from("insights_acumulado_post_community_paginas").insert({
        id_pagina: dbId,
        fecha: hoy,
        total_auto_post: acPostCom.totalAutoPost,
        impresiones: acPostCom.totalImpresiones,
        impresiones_unicas: days28PostCom,
        frecuencia: frecuenciaPostCom,
        reactions: acPostCom.totalReactions,
        engagement: acPostCom.totalEngagement,
        impresiones_days_28: days28PostCom,
      });
      console.log(`📦 insights_acumulado_post_community_paginas guardado: página ${dbId} → ${hoy}`);
    }

    for (const day of diasFaltantes) {
      const until = nextDay(day);
      const dayPrev = prevDay(day);

      // ✅ Métricas totales del día
      const impresiones = await getMetric(fbId, token, "page_media_view", day, until);
      await sleep(300);

      // ✅ Impresiones únicas reales del día
      const impresiones_unicas_dia = await getMetric(fbId, token, "page_total_media_view_unique", day, until);
      await sleep(300);

      const reactions = await getReactions(fbId, token, day, until);
      await sleep(300);
      const engagement = await getMetric(fbId, token, "page_post_engagements", day, until);
      await sleep(300);

      const days28Hoy = await getDays28(fbId, token, day);
      await sleep(300);

      const impresiones_days_28 = days28Hoy;

      // ✅ Obtener acumulado share del día y día anterior
      const { data: acShareDia } = await supabase
        .from("insights_acumulado_share")
        .select("share, impresiones, reactions, engagement")
        .eq("id_pagina", dbId)
        .eq("fecha", day)
        .maybeSingle();

      const { data: acShareDiaAnterior } = await supabase
        .from("insights_acumulado_share")
        .select("share, impresiones, reactions, engagement")
        .eq("id_pagina", dbId)
        .eq("fecha", dayPrev)
        .maybeSingle();

      let share = 0;
      let impresiones_auto = impresiones;
      let reactions_auto = reactions;
      let engagement_auto = engagement;

      if (acShareDia && acShareDiaAnterior) {
        share = Math.max(0, acShareDia.share - acShareDiaAnterior.share);

        const diffImpShare = Math.max(0, acShareDia.impresiones - acShareDiaAnterior.impresiones);
        const diffReactionsShare = Math.max(0, acShareDia.reactions - acShareDiaAnterior.reactions);
        const diffEngagementShare = Math.max(0, acShareDia.engagement - acShareDiaAnterior.engagement);

        impresiones_auto = Math.max(0, impresiones - diffImpShare);
        reactions_auto = Math.max(0, reactions - diffReactionsShare);
        engagement_auto = Math.max(0, engagement - diffEngagementShare);
      }

      const frecuenciaAuto = impresiones_unicas_dia > 0
        ? Math.round((impresiones_auto / impresiones_unicas_dia) * 100) / 100
        : 0;

      // ✅ Guardar en insights_diario_groups_auto_post
      const { error } = await supabase.from("insights_diario_groups_auto_post").insert({
        id_pagina: dbId,
        fecha: day,
        total_auto_post: share,
        impresiones: impresiones_auto,
        impresiones_unicas: impresiones_unicas_dia,
        frecuencia: frecuenciaAuto,
        reactions: reactions_auto,
        engagement: engagement_auto,
        impresiones_days_28: impresiones_days_28,
      });

      if (error) {
        console.log(`❌ INSERT ERROR ${dbId} → ${day}:`, error.message);
      } else {
        console.log(`✅ OK ${dbId} → ${day}`, {
          impresiones_auto,
          impresiones_unicas_dia,
          reactions_auto,
          engagement_auto,
          share,
          impresiones_days_28,
        });
      }

      await sleep(300);
    }
  }

  console.log("🎉 Completado.");
}

main();
