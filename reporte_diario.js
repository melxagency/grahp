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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function registrarLogSistema(fecha) {
  try {
    await supabase.from("system_logs").insert({
      clasificacion: 1,
      descripcion: "Actualizacion insights",
      fecha: fecha,
      modulo: 2,
    });
    console.log(`📋 Log registrado en system_logs → ${fecha}`);
  } catch (err) {
    console.log("❌ Error registrando log:", err.message);
  }
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

// ✅ Obtener comentarios de UN post específico
async function getComentariosPost(postId, token) {
  try {
    const res = await axios.get(
      `https://graph.facebook.com/v21.0/${postId}`,
      { params: { fields: "comments.summary(true).limit(0)", access_token: token } }
    );
    const total = res.data?.comments?.summary?.total_count || 0;
    console.log(`   💬 Post ${postId} → comentarios: ${total}`);
    return total;
  } catch (err) {
    console.log(`   ⚠️ Error comentarios post ${postId}:`, err.response?.data?.error?.message || err.message);
    return 0;
  }
}

// ✅ Obtener clicks de UN post específico
async function getClicksPost(postId, token) {
  try {
    const res = await axios.get(
      `https://graph.facebook.com/v21.0/${postId}/insights`,
      { params: { metric: "post_clicks", access_token: token } }
    );
    let clicks = 0;
    for (const metric of res.data?.data || []) {
      if (metric.period === "lifetime") {
        clicks = Number(metric.values?.[0]?.value) || 0;
      }
    }
    console.log(`   🖱️ Post ${postId} → clicks: ${clicks}`);
    return clicks;
  } catch (err) {
    console.log(`   ⚠️ Error clicks post ${postId}:`, err.response?.data?.error?.message || err.message);
    return 0;
  }
}

// ✅ Acumulado de TODOS los posts de la página
async function getAcumuladoTodosLosPosts(pageId, token) {
  let url = `https://graph.facebook.com/v21.0/${pageId}/posts`;
  let totalShare = 0;
  let totalImpresiones = 0;
  let totalImpresionesUnicas = 0;
  let totalReactions = 0;
  let totalClicks = 0;
  let totalComentarios = 0;
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

    for (let i = 0; i < posts.length; i++) {
      const postId = posts[i];
      console.log(`🔄 Procesando post ${i + 1}/${posts.length}: ${postId}`);

      // ✅ Impresiones totales + únicas
      try {
        const res1 = await axios.get(
          `https://graph.facebook.com/v21.0/${postId}/insights`,
          { params: { metric: "post_media_view,post_total_media_view_unique", access_token: token } }
        );
        let impPost = 0, impUnicasPost = 0;
        for (const metric of res1.data?.data || []) {
          if (metric.period === "lifetime") {
            const value = metric.values?.[0]?.value || 0;
            if (metric.name === "post_media_view") impPost = Number(value) || 0;
            if (metric.name === "post_total_media_view_unique") impUnicasPost = Number(value) || 0;
          }
        }
        totalImpresiones += impPost;
        totalImpresionesUnicas += impUnicasPost;
        console.log(`   📊 Post ${postId} → imp: ${impPost}, imp_unicas: ${impUnicasPost}`);
      } catch (err) {
        console.log(`   ⚠️ Error impresiones post ${postId}:`, err.response?.data?.error?.message || err.message);
      }
      await sleep(200);

      // ✅ Clicks
      const clicks = await getClicksPost(postId, token);
      totalClicks += clicks;
      await sleep(200);

      // ✅ Reactions
      try {
        const res3 = await axios.get(
          `https://graph.facebook.com/v21.0/${postId}`,
          { params: { fields: "reactions.summary(true)", access_token: token } }
        );
        const react = res3.data?.reactions?.summary?.total_count || 0;
        totalReactions += react;
        console.log(`   ❤️ Post ${postId} → reactions: ${react}`);
      } catch (err) {
        console.log(`   ⚠️ Error reactions post ${postId}:`, err.response?.data?.error?.message || err.message);
      }
      await sleep(200);

      // ✅ Comentarios
      const comentarios = await getComentariosPost(postId, token);
      totalComentarios += comentarios;
      await sleep(200);

      console.log(`   ➡️ Acumulado parcial: imp=${totalImpresiones} clicks=${totalClicks} comentarios=${totalComentarios}`);
    }
  } catch (err) {
    console.log("❌ ACUMULADO TODOS POSTS ERROR:", err.response?.data?.error?.message || err.message);
  }

  const totalEngagement = totalShare + totalReactions + totalClicks + totalComentarios;

  const frecuencia = totalImpresionesUnicas > 0
    ? Math.round((totalImpresiones / totalImpresionesUnicas) * 100) / 100
    : 0;

  console.log(`📊 RESUMEN FINAL página ${pageId}: imp=${totalImpresiones} imp_unicas=${totalImpresionesUnicas} react=${totalReactions} clicks=${totalClicks} comentarios=${totalComentarios} shares=${totalShare} engagement=${totalEngagement}`);

  return {
    totalShare, totalImpresiones, totalImpresionesUnicas, frecuencia,
    totalReactions, totalEngagement, totalClicks, totalComentarios, totalPosts,
  };
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
  let totalClicks = 0;
  let totalComentarios = 0;
  let totalShare = 0;

  for (const post of posts) {
    try {
      const res1 = await axios.get(
        `https://graph.facebook.com/v21.0/${post.post_id}/insights`,
        { params: { metric: "post_media_view,post_total_media_view_unique", access_token: token } }
      );
      for (const metric of res1.data?.data || []) {
        if (metric.period === "lifetime") {
          const value = metric.values?.[0]?.value || 0;
          if (metric.name === "post_media_view") totalImpresiones += Number(value) || 0;
          if (metric.name === "post_total_media_view_unique") totalImpresionesUnicas += Number(value) || 0;
        }
      }
      await sleep(200);
    } catch { /* silencioso */ }

    const clicks = await getClicksPost(post.post_id, token);
    totalClicks += clicks;
    await sleep(200);

    try {
      const res3 = await axios.get(
        `https://graph.facebook.com/v21.0/${post.post_id}`,
        { params: { fields: "reactions.summary(true),shares", access_token: token } }
      );
      totalReactions += res3.data?.reactions?.summary?.total_count || 0;
      totalShare += res3.data?.shares?.count || 0;
      await sleep(200);
    } catch { /* silencioso */ }

    const comentarios = await getComentariosPost(post.post_id, token);
    totalComentarios += comentarios;
    await sleep(200);
  }

  const totalEngagement = totalShare + totalReactions + totalClicks + totalComentarios;

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

  const hoy = getTodayCuba();
  const day = getYesterdayCuba();
  const dayPrev = prevDay(day);
  const until = nextDay(day);

  console.log(`📅 Procesando solo el día: ${day}`);

  for (const page of pages) {
    const fbId = page.id_page;
    const dbId = page.id;
    const token = page.token;

    if (!fbId || !token) {
      console.warn(`⚠️ Página ${dbId} sin id_page o token, saltando...`);
      continue;
    }

    try {
      await axios.get(`https://graph.facebook.com/v21.0/${fbId}`, {
        params: { fields: "id", access_token: token },
      });
    } catch (err) {
      console.log(`⚠️ Página ${dbId} (${fbId}) no accesible, saltando:`, err.response?.data?.error?.message || err.message);
      continue;
    }

    // ✅ PASO 1: Guardar insights_acumulado_share de HOY (siempre primero)
    const { data: acumuladoShareHoy } = await supabase
      .from("insights_acumulado_share")
      .select("id_record")
      .eq("id_pagina", dbId)
      .eq("fecha", hoy)
      .maybeSingle();

    if (!acumuladoShareHoy) {
      const acShare = await getAcumuladoTodosLosPosts(fbId, token);
      await sleep(500);

      await supabase.from("insights_acumulado_share").insert({
        id_pagina: dbId,
        fecha: hoy,
        share: acShare.totalShare,
        impresiones: acShare.totalImpresiones,
        impresiones_unicas: acShare.totalImpresionesUnicas,
        frecuencia: acShare.frecuencia,
        reactions: acShare.totalReactions,
        engagement: acShare.totalEngagement,
        comentarios: acShare.totalComentarios,
        clicks: acShare.totalClicks,
        impresiones_days_28: await getDays28(fbId, token, hoy),
      });
      console.log(`📦 insights_acumulado_share guardado: página ${dbId} → ${hoy}`);
    } else {
      console.log(`✅ insights_acumulado_share ya existe: página ${dbId} → ${hoy}`);
    }

    // ✅ PASO 2: Guardar insights_acumulado_post_community_paginas de HOY
    const { data: acumuladoPostComHoy } = await supabase
      .from("insights_acumulado_post_community_paginas")
      .select("id")
      .eq("id_pagina", dbId)
      .eq("fecha", hoy)
      .maybeSingle();

    if (!acumuladoPostComHoy) {
      const acPostCom = await getAcumuladoPostsComunidad(dbId, token);
      await sleep(500);

      await supabase.from("insights_acumulado_post_community_paginas").insert({
        id_pagina: dbId,
        fecha: hoy,
        total_auto_post: acPostCom.totalAutoPost,
        impresiones: acPostCom.totalImpresiones,
        impresiones_unicas: acPostCom.totalImpresionesUnicas,
        frecuencia: acPostCom.frecuencia,
        reactions: acPostCom.totalReactions,
        engagement: acPostCom.totalEngagement,
        impresiones_days_28: await getDays28(fbId, token, hoy),
      });
      console.log(`📦 insights_acumulado_post_community_paginas guardado: página ${dbId} → ${hoy}`);
    } else {
      console.log(`✅ insights_acumulado_post_community_paginas ya existe: página ${dbId} → ${hoy}`);
    }

    // ✅ PASO 3: Verificar si ya se registró insights_diario_groups_auto_post de AYER
    const { data: diarioAutoExiste } = await supabase
      .from("insights_diario_groups_auto_post")
      .select("id")
      .eq("id_pagina", dbId)
      .eq("fecha", day)
      .maybeSingle();

    if (diarioAutoExiste) {
      console.log(`✅ Página ${dbId} ya tiene insights_diario_groups_auto_post del día ${day}`);
      continue;
    }

    console.log(`📊 Procesando insights del día ${day} para página ${dbId}`);

    const impresiones = await getMetric(fbId, token, "page_media_view", day, until);
    await sleep(300);
    const impresiones_unicas_dia = await getMetric(fbId, token, "page_total_media_view_unique", day, until);
    await sleep(300);
    const reactions = await getMetric(fbId, token, "page_actions_post_reactions_total", day, until);
    await sleep(300);
    const engagement = await getMetric(fbId, token, "page_post_engagements", day, until);
    await sleep(300);
    const vistas_perfil = await getMetric(fbId, token, "page_views_total", day, until);
    await sleep(300);
    const days28Dia = await getDays28(fbId, token, day);
    await sleep(300);

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
    } else {
      console.log(`⚠️ Página ${dbId}: no hay acumulado_share del día ${day} o ${dayPrev}, registrando insight total sin restar`);
    }

    const frecuenciaAuto = impresiones_unicas_dia > 0
      ? Math.round((impresiones_auto / impresiones_unicas_dia) * 100) / 100
      : 0;

    const { error } = await supabase.from("insights_diario_groups_auto_post").insert({
      id_pagina: dbId,
      fecha: day,
      total_auto_post: share,
      impresiones: impresiones_auto,
      impresiones_unicas: impresiones_unicas_dia,
      frecuencia: frecuenciaAuto,
      reactions: reactions_auto,
      engagement: engagement_auto,
      vistas_perfil: vistas_perfil,
      impresiones_days_28: days28Dia,
    });

    if (error) {
      console.log(`❌ INSERT ERROR ${dbId} → ${day}:`, error.message);
    } else {
      console.log(`✅ OK ${dbId} → ${day}`, {
        impresiones_auto,
        impresiones_unicas_dia,
        reactions_auto,
        engagement_auto,
        vistas_perfil,
        share,
        impresiones_days_28: days28Dia,
      });
    }

    await sleep(300);
  }

  // ✅ Registrar log en system_logs al finalizar
  await registrarLogSistema(hoy);

  console.log("🎉 Completado.");
}

main();
