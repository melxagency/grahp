const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const ws = require("ws");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  { realtime: { transport: ws } }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function registrarLog(descripcion, fecha, modulo = 2) {
  try {
    await supabase.from("system_logs").insert({
      clasificacion: 1,
      descripcion,
      fecha,
      modulo,
    });
    console.log(`📋 Log: ${descripcion}`);
  } catch (err) {
    console.log("❌ Error registrando log:", err.message);
  }
}

// ===========================================
// MÉTRICAS FACEBOOK API
// ===========================================

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

async function getComentariosPost(postId, token) {
  try {
    const res = await axios.get(
      `https://graph.facebook.com/v21.0/${postId}`,
      { params: { fields: "comments.summary(true).limit(0)", access_token: token } }
    );
    return res.data?.comments?.summary?.total_count || 0;
  } catch (err) {
    console.log(`   ⚠️ Error comentarios post ${postId}:`, err.response?.data?.error?.message || err.message);
    return 0;
  }
}

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
    return clicks;
  } catch (err) {
    console.log(`   ⚠️ Error clicks post ${postId}:`, err.response?.data?.error?.message || err.message);
    return 0;
  }
}

async function getSeguidoresPagina(pageId, token) {
  try {
    const res = await axios.get(
      `https://graph.facebook.com/v21.0/${pageId}`,
      { params: { fields: "followers_count", access_token: token } }
    );
    return res.data?.followers_count || 0;
  } catch (err) {
    console.log(`⚠️ Error seguidores página ${pageId}:`, err.response?.data?.error?.message || err.message);
    return null;
  }
}

async function getTotalMensajesPagina(pageId, token) {
  let url = `https://graph.facebook.com/v21.0/${pageId}/conversations`;
  let totalMensajes = 0;
  let totalConversaciones = 0;

  try {
    let params = { fields: "message_count", limit: 100, access_token: token };
    while (url) {
      const res = await axios.get(url, { params });
      for (const conv of res.data?.data || []) {
        totalMensajes += conv.message_count || 0;
        totalConversaciones++;
      }
      url = res.data?.paging?.next || null;
      params = {};
      await sleep(100);
    }
  } catch (err) {
    console.log("❌ MENSAJES ERROR:", err.response?.data?.error?.message || err.message);
  }

  console.log(`💬 Total mensajes página ${pageId}: ${totalMensajes} (${totalConversaciones} conversaciones)`);
  return totalMensajes;
}

// ===========================================
// BLOQUE 1 - SHARE: Registrar posts nuevos en services_registro_post_share_fb
// y calcular acumulado solo sobre esos posts registrados
// ===========================================

async function descubrirYRegistrarPostsShare(dbPageId, pageId, token, hoy) {
  let url = `https://graph.facebook.com/v21.0/${pageId}/posts`;
  let nuevosRegistrados = 0;

  try {
    const { data: postsExistentes } = await supabase
      .from("services_registro_post_share_fb")
      .select("post_id")
      .eq("pagina", dbPageId);

    const idsExistentes = new Set((postsExistentes || []).map((p) => p.post_id));

    while (url) {
      const res = await axios.get(url, {
        params: { fields: "id", limit: 100, access_token: token },
      });

      for (const post of res.data?.data || []) {
        if (!idsExistentes.has(post.id)) {
          const { error } = await supabase.from("services_registro_post_share_fb").insert({
            pagina: dbPageId,
            post_id: post.id,
            fecha: hoy,
          });
          if (!error) {
            nuevosRegistrados++;
            idsExistentes.add(post.id);
          } else {
            console.log(`⚠️ Error registrando post share ${post.id}:`, error.message);
          }
        }
      }
      url = res.data?.paging?.next || null;
    }
  } catch (err) {
    console.log("❌ DESCUBRIR POSTS SHARE ERROR:", err.response?.data?.error?.message || err.message);
  }

  console.log(`📝 Posts share nuevos registrados para página ${dbPageId}: ${nuevosRegistrados}`);
  return nuevosRegistrados;
}

async function getAcumuladoPostsShare(dbPageId, token) {
  const { data: posts } = await supabase
    .from("services_registro_post_share_fb")
    .select("post_id")
    .eq("pagina", dbPageId);

  if (!posts?.length) {
    console.log(`⚠️ Sin posts registrados en services_registro_post_share_fb para página ${dbPageId}`);
    return {
      totalShare: 0, totalImpresiones: 0, totalImpresionesUnicas: 0,
      frecuencia: 0, totalReactions: 0, totalEngagement: 0,
      totalClicks: 0, totalComentarios: 0,
    };
  }

  let totalShare = 0, totalImpresiones = 0, totalImpresionesUnicas = 0;
  let totalReactions = 0, totalClicks = 0, totalComentarios = 0;

  console.log(`📦 Calculando acumulado share para ${posts.length} posts registrados de página ${dbPageId}...`);

  for (const post of posts) {
    const postId = post.post_id;

    try {
      const res1 = await axios.get(
        `https://graph.facebook.com/v21.0/${postId}/insights`,
        { params: { metric: "post_media_view,post_total_media_view_unique", access_token: token } }
      );
      for (const metric of res1.data?.data || []) {
        if (metric.period === "lifetime") {
          const value = metric.values?.[0]?.value || 0;
          if (metric.name === "post_media_view") totalImpresiones += Number(value) || 0;
          if (metric.name === "post_total_media_view_unique") totalImpresionesUnicas += Number(value) || 0;
        }
      }
    } catch { /* silencioso */ }
    await sleep(200);

    const clicks = await getClicksPost(postId, token);
    totalClicks += clicks;
    await sleep(200);

    try {
      const res3 = await axios.get(
        `https://graph.facebook.com/v21.0/${postId}`,
        { params: { fields: "reactions.summary(true),shares", access_token: token } }
      );
      totalReactions += res3.data?.reactions?.summary?.total_count || 0;
      totalShare += res3.data?.shares?.count || 0;
    } catch { /* silencioso */ }
    await sleep(200);

    const comentarios = await getComentariosPost(postId, token);
    totalComentarios += comentarios;
    await sleep(200);
  }

  const totalEngagement = totalShare + totalReactions + totalClicks + totalComentarios;
  const frecuencia = totalImpresionesUnicas > 0
    ? Math.round((totalImpresiones / totalImpresionesUnicas) * 100) / 100
    : 0;

  console.log(`📊 Acumulado share página ${dbPageId}: imp=${totalImpresiones} imp_u=${totalImpresionesUnicas} react=${totalReactions} clicks=${totalClicks} comentarios=${totalComentarios} shares=${totalShare} engagement=${totalEngagement}`);

  return {
    totalShare, totalImpresiones, totalImpresionesUnicas, frecuencia,
    totalReactions, totalEngagement, totalClicks, totalComentarios,
  };
}

// ===========================================
// BLOQUE 1 - COMMUNITY POSTS: posts de comercial_post_community_paginas
// ===========================================

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
  let totalImpresiones = 0, totalImpresionesUnicas = 0;
  let totalReactions = 0, totalClicks = 0, totalComentarios = 0, totalShare = 0;

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

// ===========================================
// BLOQUE 2 - SERVICIOS: descubrir y registrar posts de páginas clasificacion=2
// ===========================================

async function descubrirYRegistrarPostsServices(dbPageId, pageId, token, hoy) {
  let url = `https://graph.facebook.com/v21.0/${pageId}/posts`;
  let nuevosRegistrados = 0;

  try {
    const { data: postsExistentes } = await supabase
      .from("services_registro_post_community_paginas")
      .select("post_id")
      .eq("pagina", dbPageId);

    const idsExistentes = new Set((postsExistentes || []).map((p) => p.post_id));

    while (url) {
      const res = await axios.get(url, {
        params: { fields: "id", limit: 100, access_token: token },
      });

      for (const post of res.data?.data || []) {
        if (!idsExistentes.has(post.id)) {
          const { error } = await supabase.from("services_registro_post_community_paginas").insert({
            pagina: dbPageId,
            post_id: post.id,
            fecha_inicio: hoy,
            activo: true,
          });
          if (!error) {
            nuevosRegistrados++;
            idsExistentes.add(post.id);
          } else {
            console.log(`⚠️ Error registrando post servicio ${post.id}:`, error.message);
          }
        }
      }
      url = res.data?.paging?.next || null;
    }
  } catch (err) {
    console.log("❌ DESCUBRIR POSTS SERVICIOS ERROR:", err.response?.data?.error?.message || err.message);
  }

  console.log(`📝 Posts servicios nuevos registrados para página ${dbPageId}: ${nuevosRegistrados}`);
  return nuevosRegistrados;
}

async function registrarInsightsPostsServices(dbPageId, token, hoy) {
  const { data: posts } = await supabase
    .from("services_registro_post_community_paginas")
    .select("post_id")
    .eq("pagina", dbPageId)
    .eq("activo", true);

  if (!posts?.length) {
    console.log(`⚠️ Sin posts activos en services para página ${dbPageId}`);
    return;
  }

  let insertados = 0;
  for (const post of posts) {
    const { data: yaExiste } = await supabase
      .from("insights_acumulado_post_community_paginas_facebook")
      .select("id")
      .eq("post_id", post.post_id)
      .eq("fecha", hoy)
      .maybeSingle();

    if (yaExiste) continue;

    let impresiones = 0, impresionesUnicas = 0, share = 0, reactions = 0, comentarios = 0, clicks = 0;

    try {
      const res1 = await axios.get(
        `https://graph.facebook.com/v21.0/${post.post_id}/insights`,
        { params: { metric: "post_media_view,post_total_media_view_unique", access_token: token } }
      );
      for (const metric of res1.data?.data || []) {
        if (metric.period === "lifetime") {
          const value = metric.values?.[0]?.value || 0;
          if (metric.name === "post_media_view") impresiones = Number(value) || 0;
          if (metric.name === "post_total_media_view_unique") impresionesUnicas = Number(value) || 0;
        }
      }
    } catch { /* silencioso */ }
    await sleep(150);

    clicks = await getClicksPost(post.post_id, token);
    await sleep(150);

    try {
      const res3 = await axios.get(
        `https://graph.facebook.com/v21.0/${post.post_id}`,
        { params: { fields: "reactions.summary(true),shares", access_token: token } }
      );
      reactions = res3.data?.reactions?.summary?.total_count || 0;
      share = res3.data?.shares?.count || 0;
    } catch { /* silencioso */ }
    await sleep(150);

    comentarios = await getComentariosPost(post.post_id, token);
    await sleep(150);

    const engagement = share + reactions + clicks + comentarios;

    const { error } = await supabase.from("insights_acumulado_post_community_paginas_facebook").insert({
      post_id: post.post_id,
      fecha: hoy,
      impresiones,
      impresiones_unicas: impresionesUnicas,
      share,
      reactions,
      engagement,
      comentarios,
      clicks,
    });

    if (error) {
      console.log(`❌ ERROR insight post servicio ${post.post_id}:`, error.message);
    } else {
      insertados++;
      console.log(`📊 Insight servicio post ${post.post_id} → imp=${impresiones} share=${share} react=${reactions}`);
    }
  }

  console.log(`✅ Insights servicios insertados para página ${dbPageId}: ${insertados}/${posts.length}`);
}

// ===========================================
// MAIN
// ===========================================

async function main() {
  const hoy = getTodayCuba();
  const day = getYesterdayCuba();
  const until = nextDay(day);

  console.log(`\n📅 Fecha de hoy (Cuba): ${hoy} | Procesando insights de ayer: ${day}\n`);

  // ===========================================
  // BLOQUE 1: Páginas clasificacion=1, red_social=2
  // ===========================================
  const { data: pages, error: pagesError } = await supabase
    .from("community_paginas")
    .select("*")
    .eq("clasificacion", 1)
    .eq("red_social", 2);

  if (pagesError || !pages?.length) {
    console.log("❌ Error cargando páginas (clasificacion=1):", pagesError);
  } else {
    console.log(`📄 Páginas community encontradas (clasificacion=1): ${pages.length}\n`);

    for (const page of pages) {
      const fbId = page.id_page;
      const dbId = page.id;
      const token = page.token;
      const nombre = page.nombre || `Página ${dbId}`;

      if (!fbId || !token) {
        console.warn(`⚠️ [${nombre}] Sin id_page o token, saltando...`);
        continue;
      }

      try {
        await axios.get(`https://graph.facebook.com/v21.0/${fbId}`, {
          params: { fields: "id", access_token: token },
        });
      } catch (err) {
        console.log(`⚠️ [${nombre}] No accesible vía API, saltando:`, err.response?.data?.error?.message || err.message);
        continue;
      }

      console.log(`\n▶️ Procesando página: ${nombre} (id=${dbId})`);

      // PASO 1: Descubrir y registrar posts nuevos en services_registro_post_share_fb
      const nuevosShare = await descubrirYRegistrarPostsShare(dbId, fbId, token, hoy);
      await registrarLog(
        `[${nombre}] Descubrimiento posts share FB: ${nuevosShare} nuevos registrados en services_registro_post_share_fb`,
        hoy
      );
      await sleep(300);

      // PASO 2: Acumulado de todos los posts registrados en services_registro_post_share_fb
      const { data: acumuladoShareHoyExiste } = await supabase
        .from("insights_acumulado_share_facebook")
        .select("id_record")
        .eq("id_pagina", dbId)
        .eq("fecha", hoy)
        .maybeSingle();

      if (!acumuladoShareHoyExiste) {
        const acShare = await getAcumuladoPostsShare(dbId, token);
        await sleep(500);

        const { error } = await supabase.from("insights_acumulado_share_facebook").insert({
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

        if (!error) {
          await registrarLog(
            `[${nombre}] Acumulado share FB guardado → share=${acShare.totalShare} imp=${acShare.totalImpresiones} react=${acShare.totalReactions}`,
            hoy
          );
        } else {
          console.log(`❌ Error insertando acumulado share ${nombre}:`, error.message);
        }
      } else {
        console.log(`✅ [${nombre}] Acumulado share ya existe para ${hoy}`);
      }

      // PASO 3: Acumulado de posts de comunidad (comercial_post_community_paginas)
      const { data: acumuladoPostComHoy } = await supabase
        .from("insights_acumulado_post_community_paginas_facebook")
        .select("id")
        .eq("id_pagina", dbId)
        .eq("fecha", hoy)
        .maybeSingle();

      if (!acumuladoPostComHoy) {
        const acPostCom = await getAcumuladoPostsComunidad(dbId, token);
        await sleep(500);

        const { error } = await supabase.from("insights_acumulado_post_community_paginas_facebook").insert({
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

        if (!error) {
          await registrarLog(
            `[${nombre}] Acumulado posts community FB guardado → ${acPostCom.totalAutoPost} posts activos`,
            hoy
          );
        } else {
          console.log(`❌ Error insertando acumulado community ${nombre}:`, error.message);
        }
      } else {
        console.log(`✅ [${nombre}] Acumulado posts community ya existe para ${hoy}`);
      }

      // PASO 4: Insights diarios de ayer (delta) → insights_diario_groups_auto_post_facebook
      const { data: diarioAutoExiste } = await supabase
        .from("insights_diario_groups_auto_post_facebook")
        .select("id")
        .eq("id_pagina", dbId)
        .eq("fecha", day)
        .maybeSingle();

      if (!diarioAutoExiste) {
        console.log(`📊 [${nombre}] Calculando insights diarios del ${day}...`);

        const impresiones           = await getMetric(fbId, token, "page_media_view", day, until);
        await sleep(300);
        const impresiones_unicas_dia = await getMetric(fbId, token, "page_total_media_view_unique", day, until);
        await sleep(300);
        const reactions              = await getMetric(fbId, token, "page_actions_post_reactions_total", day, until);
        await sleep(300);
        const engagement             = await getMetric(fbId, token, "page_post_engagements", day, until);
        await sleep(300);
        const vistas_perfil          = await getMetric(fbId, token, "page_views_total", day, until);
        await sleep(300);
        const days28Dia              = await getDays28(fbId, token, day);
        await sleep(300);

        const { data: acShareHoy }  = await supabase
          .from("insights_acumulado_share_facebook")
          .select("share, impresiones, impresiones_unicas, reactions, engagement")
          .eq("id_pagina", dbId).eq("fecha", hoy).maybeSingle();

        const { data: acShareAyer } = await supabase
          .from("insights_acumulado_share_facebook")
          .select("share, impresiones, impresiones_unicas, reactions, engagement")
          .eq("id_pagina", dbId).eq("fecha", day).maybeSingle();

        let share = 0;
        let impresiones_auto       = impresiones;
        let impresiones_unicas_auto = impresiones_unicas_dia;
        let reactions_auto         = reactions;
        let engagement_auto        = engagement;

        if (acShareHoy && acShareAyer) {
          share = Math.max(0, acShareHoy.share - acShareAyer.share);
          impresiones_auto        = Math.max(0, impresiones        - Math.max(0, acShareHoy.impresiones       - acShareAyer.impresiones));
          impresiones_unicas_auto = Math.max(0, impresiones_unicas_dia - Math.max(0, acShareHoy.impresiones_unicas - acShareAyer.impresiones_unicas));
          reactions_auto          = Math.max(0, reactions          - Math.max(0, acShareHoy.reactions         - acShareAyer.reactions));
          engagement_auto         = Math.max(0, engagement         - Math.max(0, acShareHoy.engagement        - acShareAyer.engagement));
        } else {
          console.log(`⚠️ [${nombre}] Sin acumulado share de ${hoy} o ${day}, registrando total sin restar`);
        }

        const frecuenciaAuto = impresiones_unicas_auto > 0
          ? Math.round((impresiones_auto / impresiones_unicas_auto) * 100) / 100
          : 0;

        const { error } = await supabase.from("insights_diario_groups_auto_post_facebook").insert({
          id_pagina: dbId,
          fecha: day,
          total_auto_post: share,
          impresiones: impresiones_auto,
          impresiones_unicas: impresiones_unicas_auto,
          frecuencia: frecuenciaAuto,
          reactions: reactions_auto,
          engagement: engagement_auto,
          vistas_perfil,
          impresiones_days_28: days28Dia,
        });

        if (!error) {
          await registrarLog(
            `[${nombre}] Insights diarios FB registrados para ${day} → imp=${impresiones_auto} react=${reactions_auto} engagement=${engagement_auto}`,
            hoy
          );
        } else {
          console.log(`❌ [${nombre}] Error insertando insights diarios:`, error.message);
        }

        await sleep(300);
      } else {
        console.log(`✅ [${nombre}] Insights diarios ya registrados para ${day}`);
      }

      // PASO 5: Seguidores actuales de la página
      const { data: seguidoresHoyExiste } = await supabase
        .from("insights_crecimiento_acumulado_paginas")
        .select("id")
        .eq("id_pagina", fbId)
        .eq("fecha", hoy)
        .maybeSingle();

      if (!seguidoresHoyExiste) {
        const seguidores = await getSeguidoresPagina(fbId, token);
        if (seguidores !== null) {
          const { error } = await supabase.from("insights_crecimiento_acumulado_paginas").insert({
            id_pagina: fbId,
            fecha: hoy,
            seguidores,
          });
          if (!error) {
            await registrarLog(
              `[${nombre}] Seguidores FB actualizados → ${seguidores} seguidores`,
              hoy
            );
          } else {
            console.log(`❌ [${nombre}] Error insertando seguidores:`, error.message);
          }
        }
        await sleep(200);
      } else {
        console.log(`✅ [${nombre}] Seguidores ya registrados para ${hoy}`);
      }

      // PASO 6: Total mensajes acumulados de la página
      const { data: mensajesHoyExiste } = await supabase
        .from("insights_acumulado_mensajes_paginas_facebook")
        .select("id")
        .eq("id_pagina", fbId)
        .eq("fecha", hoy)
        .maybeSingle();

      if (!mensajesHoyExiste) {
        const totalMensajes = await getTotalMensajesPagina(fbId, token);
        await sleep(300);

        const { error } = await supabase.from("insights_acumulado_mensajes_paginas_facebook").insert({
          id_pagina: fbId,
          fecha: hoy,
          total_mensajes: totalMensajes,
        });
        if (!error) {
          await registrarLog(
            `[${nombre}] Mensajes FB actualizados → ${totalMensajes} mensajes acumulados`,
            hoy
          );
        } else {
          console.log(`❌ [${nombre}] Error insertando mensajes:`, error.message);
        }
      } else {
        console.log(`✅ [${nombre}] Mensajes ya registrados para ${hoy}`);
      }
    }
  }

  // ===========================================
  // BLOQUE 2: Páginas clasificacion=2, red_social=2 (servicios)
  // ===========================================
  const { data: pagesServices, error: pagesServicesError } = await supabase
    .from("community_paginas")
    .select("*")
    .eq("clasificacion", 2)
    .eq("red_social", 2);

  if (pagesServicesError || !pagesServices?.length) {
    console.log("❌ Error cargando páginas servicios (clasificacion=2):", pagesServicesError);
  } else {
    console.log(`\n📄 Páginas servicios encontradas (clasificacion=2): ${pagesServices.length}\n`);

    for (const page of pagesServices) {
      const fbId   = page.id_page;
      const dbId   = page.id;
      const token  = page.token;
      const nombre = page.nombre || `Página servicios ${dbId}`;

      if (!fbId || !token) {
        console.warn(`⚠️ [${nombre}] Sin id_page o token, saltando...`);
        continue;
      }

      try {
        await axios.get(`https://graph.facebook.com/v21.0/${fbId}`, {
          params: { fields: "id", access_token: token },
        });
      } catch (err) {
        console.log(`⚠️ [${nombre}] No accesible vía API, saltando:`, err.response?.data?.error?.message || err.message);
        continue;
      }

      console.log(`\n▶️ Procesando página servicios: ${nombre} (id=${dbId})`);

      const nuevos = await descubrirYRegistrarPostsServices(dbId, fbId, token, hoy);
      if (nuevos > 0) {
        await registrarLog(
          `[${nombre}] Descubrimiento posts servicios FB: ${nuevos} nuevos registrados en services_registro_post_community_paginas`,
          hoy
        );
      }
      await sleep(300);

      await registrarInsightsPostsServices(dbId, token, hoy);
      await registrarLog(
        `[${nombre}] Insights diarios posts servicios FB actualizados en insights_acumulado_post_community_paginas_facebook`,
        hoy
      );
      await sleep(300);
    }
  }

  console.log("\n🎉 Reporte diario Facebook completado.");
}

main();
