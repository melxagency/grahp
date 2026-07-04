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

async function registrarLog(descripcion, fecha) {
  try {
    await supabase.from("system_logs").insert({ clasificacion: 1, descripcion, fecha, modulo: 2 });
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
        if (typeof v.value === "object" && v.value !== null)
          return sum + Object.values(v.value).reduce((s, n) => s + (Number(n) || 0), 0);
        return sum + (Number(v.value) || 0);
      }, 0);
    } catch (err) {
      const isTransient = err.response?.data?.error?.is_transient;
      const msg = err.response?.data?.error?.message || err.message;
      if (isTransient && attempt < retries) await sleep(attempt * 3000);
      else { console.log(`❌ METRIC ERROR ${metric}:`, msg); return 0; }
    }
  }
  return 0;
}

async function getDays28(pageId, token, day, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(
        `https://graph.facebook.com/v21.0/${pageId}/insights`,
        { params: { metric: "page_total_media_view_unique", period: "days_28", since: day, until: nextDay(day), access_token: token } }
      );
      return res.data.data?.[0]?.values?.[0]?.value || 0;
    } catch (err) {
      const isTransient = err.response?.data?.error?.is_transient;
      const msg = err.response?.data?.error?.message || err.message;
      if (isTransient && attempt < retries) await sleep(attempt * 3000);
      else { console.log(`❌ DAYS28 ERROR:`, msg); return 0; }
    }
  }
  return 0;
}

async function getComentariosPost(postId, token) {
  try {
    const res = await axios.get(`https://graph.facebook.com/v21.0/${postId}`,
      { params: { fields: "comments.summary(true).limit(0)", access_token: token } });
    return res.data?.comments?.summary?.total_count || 0;
  } catch { return 0; }
}

async function getClicksPost(postId, token) {
  try {
    const res = await axios.get(`https://graph.facebook.com/v21.0/${postId}/insights`,
      { params: { metric: "post_clicks", access_token: token } });
    for (const m of res.data?.data || [])
      if (m.period === "lifetime") return Number(m.values?.[0]?.value) || 0;
    return 0;
  } catch { return 0; }
}

async function getSeguidoresPagina(pageId, token) {
  try {
    const res = await axios.get(`https://graph.facebook.com/v21.0/${pageId}`,
      { params: { fields: "followers_count", access_token: token } });
    return res.data?.followers_count || 0;
  } catch (err) {
    console.log(`⚠️ Error seguidores ${pageId}:`, err.response?.data?.error?.message || err.message);
    return null;
  }
}

async function getTotalMensajesPagina(pageId, token) {
  let url = `https://graph.facebook.com/v21.0/${pageId}/conversations`;
  let totalMensajes = 0;
  try {
    let params = { fields: "message_count", limit: 100, access_token: token };
    while (url) {
      const res = await axios.get(url, { params });
      for (const conv of res.data?.data || []) totalMensajes += conv.message_count || 0;
      url = res.data?.paging?.next || null;
      params = {};
      await sleep(100);
    }
  } catch (err) {
    console.log("❌ MENSAJES ERROR:", err.response?.data?.error?.message || err.message);
  }
  console.log(`💬 Total mensajes página ${pageId}: ${totalMensajes}`);
  return totalMensajes;
}

async function getPostInsights(postId, token) {
  let impresiones = 0, impresionesUnicas = 0, share = 0, reactions = 0, comentarios = 0, clicks = 0;
  try {
    const res1 = await axios.get(`https://graph.facebook.com/v21.0/${postId}/insights`,
      { params: { metric: "post_media_view,post_total_media_view_unique", access_token: token } });
    for (const m of res1.data?.data || []) {
      if (m.period === "lifetime") {
        const v = m.values?.[0]?.value || 0;
        if (m.name === "post_media_view") impresiones = Number(v) || 0;
        if (m.name === "post_total_media_view_unique") impresionesUnicas = Number(v) || 0;
      }
    }
  } catch { /* silencioso */ }
  await sleep(200);

  clicks = await getClicksPost(postId, token);
  await sleep(200);

  try {
    const res3 = await axios.get(`https://graph.facebook.com/v21.0/${postId}`,
      { params: { fields: "reactions.summary(true),shares", access_token: token } });
    reactions = res3.data?.reactions?.summary?.total_count || 0;
    share = res3.data?.shares?.count || 0;
  } catch { /* silencioso */ }
  await sleep(200);

  comentarios = await getComentariosPost(postId, token);
  await sleep(200);

  return { impresiones, impresionesUnicas, share, reactions, comentarios, clicks };
}

// ===========================================
// BLOQUE 1 - SHARE
// oper_registro_post_share_fb
// ===========================================

async function getAcumuladoPostsShare(pageServiceId, token) {
  const { data: posts } = await supabase
    .from("oper_registro_post_share_fb")
    .select("post_id")
    .eq("page_service", pageServiceId);

  if (!posts?.length) {
    console.log(`⚠️ Sin posts en oper_registro_post_share_fb para page_service=${pageServiceId}`);
    return { totalShare: 0, totalImpresiones: 0, totalImpresionesUnicas: 0, frecuencia: 0, totalReactions: 0, totalEngagement: 0, totalClicks: 0, totalComentarios: 0 };
  }

  let totalShare = 0, totalImpresiones = 0, totalImpresionesUnicas = 0;
  let totalReactions = 0, totalClicks = 0, totalComentarios = 0;

  console.log(`📦 Calculando acumulado share: ${posts.length} posts...`);

  for (const post of posts) {
    const ins = await getPostInsights(post.post_id, token);
    totalImpresiones       += ins.impresiones;
    totalImpresionesUnicas += ins.impresionesUnicas;
    totalShare             += ins.share;
    totalReactions         += ins.reactions;
    totalClicks            += ins.clicks;
    totalComentarios       += ins.comentarios;
  }

  const totalEngagement = totalShare + totalReactions + totalClicks + totalComentarios;
  const frecuencia = totalImpresionesUnicas > 0
    ? Math.round((totalImpresiones / totalImpresionesUnicas) * 100) / 100 : 0;

  console.log(`📊 Acumulado: imp=${totalImpresiones} share=${totalShare} react=${totalReactions} eng=${totalEngagement}`);
  return { totalShare, totalImpresiones, totalImpresionesUnicas, frecuencia, totalReactions, totalEngagement, totalClicks, totalComentarios };
}

// ===========================================
// BLOQUE 1 - COMMUNITY POSTS (comercial_post_community_paginas)
// ===========================================

async function getAcumuladoPostsComunidad(dbPageId, token) {
  const { data: posts } = await supabase
    .from("comercial_post_community_paginas")
    .select("post_id")
    .eq("pagina", dbPageId)
    .eq("activo", true);

  if (!posts?.length) return { totalAutoPost: 0, totalImpresiones: 0, totalImpresionesUnicas: 0, frecuencia: 0, totalReactions: 0, totalEngagement: 0 };

  let totalAutoPost = posts.length;
  let totalImpresiones = 0, totalImpresionesUnicas = 0;
  let totalReactions = 0, totalClicks = 0, totalComentarios = 0, totalShare = 0;

  for (const post of posts) {
    const ins = await getPostInsights(post.post_id, token);
    totalImpresiones       += ins.impresiones;
    totalImpresionesUnicas += ins.impresionesUnicas;
    totalShare             += ins.share;
    totalReactions         += ins.reactions;
    totalClicks            += ins.clicks;
    totalComentarios       += ins.comentarios;
  }

  const totalEngagement = totalShare + totalReactions + totalClicks + totalComentarios;
  const frecuencia = totalImpresionesUnicas > 0
    ? Math.round((totalImpresiones / totalImpresionesUnicas) * 100) / 100 : 0;

  return { totalAutoPost, totalImpresiones, totalImpresionesUnicas, frecuencia, totalReactions, totalEngagement };
}

// ===========================================
// BLOQUE 2 - SERVICIOS
// oper_registro_post_community_paginas
// ===========================================

async function descubrirYRegistrarPostsServices(pageServiceId, pageId, token, hoy) {
  let url = `https://graph.facebook.com/v21.0/${pageId}/posts`;
  let nuevos = 0;

  try {
    const { data: existentes } = await supabase
      .from("oper_registro_post_community_paginas")
      .select("post_id")
      .eq("page_service", pageServiceId);

    const ids = new Set((existentes || []).map((p) => p.post_id));

    while (url) {
      const res = await axios.get(url, { params: { fields: "id", limit: 100, access_token: token } });
      for (const post of res.data?.data || []) {
        if (!ids.has(post.id)) {
          const { error } = await supabase.from("oper_registro_post_community_paginas").insert({
            page_service: pageServiceId,
            post_id: post.id,
            fecha_inicio: hoy,
            activo: true,
          });
          if (!error) { nuevos++; ids.add(post.id); }
          else console.log(`⚠️ Error registrando post servicio ${post.id}:`, error.message);
        }
      }
      url = res.data?.paging?.next || null;
    }
  } catch (err) {
    console.log("❌ DESCUBRIR POSTS SERVICIOS ERROR:", err.response?.data?.error?.message || err.message);
  }

  console.log(`📝 Posts servicios nuevos: ${nuevos}`);
  return nuevos;
}

async function registrarInsightsPostsServices(pageServiceId, token, hoy) {
  const { data: posts } = await supabase
    .from("oper_registro_post_community_paginas")
    .select("post_id")
    .eq("page_service", pageServiceId)
    .eq("activo", true)
    .not("page_service", "is", null);

  if (!posts?.length) {
    console.log(`⚠️ Sin posts activos con page_service=${pageServiceId}`);
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

    const ins = await getPostInsights(post.post_id, token);
    const engagement = ins.share + ins.reactions + ins.clicks + ins.comentarios;

    const { error } = await supabase.from("insights_acumulado_post_community_paginas_facebook").insert({
      post_id: post.post_id,
      fecha: hoy,
      impresiones: ins.impresiones,
      impresiones_unicas: ins.impresionesUnicas,
      share: ins.share,
      reactions: ins.reactions,
      engagement,
      comentarios: ins.comentarios,
      clicks: ins.clicks,
    });

    if (error) console.log(`❌ ERROR insight servicio ${post.post_id}:`, error.message);
    else { insertados++; console.log(`📊 Insight servicio ${post.post_id} → imp=${ins.impresiones} share=${ins.share}`); }
  }

  console.log(`✅ Insights servicios insertados: ${insertados}/${posts.length}`);
}

// ===========================================
// MAIN
// ===========================================

async function main() {
  const hoy = getTodayCuba();
  const day = getYesterdayCuba();
  const until = nextDay(day);

  console.log(`\n📅 Hoy (Cuba): ${hoy} | Insights de ayer: ${day}\n`);

  // ===========================================
  // BLOQUE 1: Páginas clasificacion=1, red_social=2
  // ===========================================
  const { data: pages, error: pagesError } = await supabase
    .from("community_paginas").select("*").eq("clasificacion", 1).eq("red_social", 2);

  if (pagesError || !pages?.length) {
    console.log("❌ Error cargando páginas (clasificacion=1):", pagesError);
  } else {
    console.log(`📄 Páginas community (clasificacion=1): ${pages.length}\n`);

    for (const page of pages) {
      const fbId   = page.id_page;
      const dbId   = page.id;
      const token  = page.token;
      const nombre = page.nombre || `Página ${dbId}`;

      if (!fbId || !token) { console.warn(`⚠️ [${nombre}] Sin id_page o token`); continue; }

      try {
        await axios.get(`https://graph.facebook.com/v21.0/${fbId}`, { params: { fields: "id", access_token: token } });
      } catch (err) {
        console.log(`⚠️ [${nombre}] No accesible:`, err.response?.data?.error?.message || err.message);
        continue;
      }

      console.log(`\n▶️ [${nombre}] (id=${dbId})`);

      // Buscar page_service tipo=1 para esta página (donde están los posts registrados manualmente)
      const { data: psRow } = await supabase
        .from("services_pages").select("id")
        .eq("id_pagina", dbId)
        .eq("tipo_page_services", 1)
        .order("fecha_inicio", { ascending: false })
        .limit(1).maybeSingle();

      const pageServiceId = psRow?.id || null;

      // PASO 1+2: Calcular acumulado share de posts ya registrados en oper_registro_post_share_fb
      // Los posts se registran manualmente — el script solo lee los existentes
      const { data: shareHoyExiste } = await supabase
        .from("insights_acumulado_share_facebook")
        .select("id_record").eq("id_pagina", dbId).eq("fecha", hoy).maybeSingle();

      if (!shareHoyExiste) {
        const acShare = pageServiceId
          ? await getAcumuladoPostsShare(pageServiceId, token)
          : { totalShare: 0, totalImpresiones: 0, totalImpresionesUnicas: 0, frecuencia: 0, totalReactions: 0, totalEngagement: 0, totalClicks: 0, totalComentarios: 0 };
        await sleep(300);

        const { error } = await supabase.from("insights_acumulado_share_facebook").insert({
          id_pagina: dbId, fecha: hoy,
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
        if (error) console.log(`❌ [${nombre}] Error acumulado share:`, error.message);
        else console.log(`✅ [${nombre}] Acumulado share guardado`);
      } else {
        console.log(`✅ [${nombre}] Acumulado share ya existe para ${hoy}`);
      }

      // PASO 3: Acumulado posts comunidad
      await getAcumuladoPostsComunidad(dbId, token);
      await sleep(300);

      // PASO 4: Insights diarios de ayer (delta)
      const { data: diarioExiste } = await supabase
        .from("insights_diario_groups_auto_post_facebook")
        .select("id").eq("id_pagina", dbId).eq("fecha", day).maybeSingle();

      if (!diarioExiste) {
        console.log(`📊 [${nombre}] Calculando delta del ${day}...`);

        const impresiones            = await getMetric(fbId, token, "page_media_view", day, until);
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

        const { data: acShareHoy }  = await supabase.from("insights_acumulado_share_facebook")
          .select("share,impresiones,impresiones_unicas,reactions,engagement")
          .eq("id_pagina", dbId).eq("fecha", hoy).maybeSingle();
        const { data: acShareAyer } = await supabase.from("insights_acumulado_share_facebook")
          .select("share,impresiones,impresiones_unicas,reactions,engagement")
          .eq("id_pagina", dbId).eq("fecha", day).maybeSingle();

        let share = 0, imp_auto = impresiones, imp_u_auto = impresiones_unicas_dia;
        let react_auto = reactions, eng_auto = engagement;

        if (acShareHoy && acShareAyer) {
          share      = Math.max(0, acShareHoy.share    - acShareAyer.share);
          imp_auto   = Math.max(0, impresiones         - Math.max(0, acShareHoy.impresiones        - acShareAyer.impresiones));
          imp_u_auto = Math.max(0, impresiones_unicas_dia - Math.max(0, acShareHoy.impresiones_unicas - acShareAyer.impresiones_unicas));
          react_auto = Math.max(0, reactions            - Math.max(0, acShareHoy.reactions          - acShareAyer.reactions));
          eng_auto   = Math.max(0, engagement           - Math.max(0, acShareHoy.engagement         - acShareAyer.engagement));
        } else {
          console.log(`⚠️ [${nombre}] Sin acumulado share de ${hoy} o ${day}, registrando total`);
        }

        const frecuencia = imp_u_auto > 0 ? Math.round((imp_auto / imp_u_auto) * 100) / 100 : 0;

        // total_auto_post: suma de post_diarios de grupos activos en oper_registro_autopost_groups_fb
        const { data: autopostRows } = await supabase
          .from("oper_registro_autopost_groups_fb")
          .select("post_diarios")
          .eq("id_page_service", pageServiceId)
          .is("fecha_final", null);

        const total_auto_post = (autopostRows || []).reduce((sum, r) => sum + (r.post_diarios || 0), 0);

        const { error } = await supabase.from("insights_diario_groups_auto_post_facebook").insert({
          id_pagina: dbId, fecha: day,
          total_auto_post,
          impresiones: imp_auto,
          impresiones_unicas: imp_u_auto,
          frecuencia,
          reactions: react_auto,
          engagement: eng_auto,
          vistas_perfil,
          impresiones_days_28: days28Dia,
        });

        if (error) console.log(`❌ [${nombre}] Error insights diarios:`, error.message);
        else console.log(`✅ [${nombre}] Insights diarios registrados para ${day}`);
        await sleep(300);
      } else {
        console.log(`✅ [${nombre}] Insights diarios ya existen para ${day}`);
      }

      // PASO 5: Seguidores
      const { data: seguidoresExiste } = await supabase
        .from("insights_crecimiento_acumulado_paginas")
        .select("id").eq("id_pagina", fbId).eq("fecha", hoy).maybeSingle();

      if (!seguidoresExiste) {
        const seguidores = await getSeguidoresPagina(fbId, token);
        if (seguidores !== null) {
          const { error } = await supabase.from("insights_crecimiento_acumulado_paginas")
            .insert({ id_pagina: fbId, fecha: hoy, seguidores });
          if (error) console.log(`❌ [${nombre}] Error seguidores:`, error.message);
        }
        await sleep(200);
      } else {
        console.log(`✅ [${nombre}] Seguidores ya registrados para ${hoy}`);
      }

      // PASO 6: Mensajes
      const { data: mensajesExiste } = await supabase
        .from("insights_acumulado_mensajes_paginas_facebook")
        .select("id").eq("id_pagina", fbId).eq("fecha", hoy).maybeSingle();

      if (!mensajesExiste) {
        const totalMensajes = await getTotalMensajesPagina(fbId, token);
        await sleep(300);
        const { error } = await supabase.from("insights_acumulado_mensajes_paginas_facebook")
          .insert({ id_pagina: fbId, fecha: hoy, total_mensajes: totalMensajes });
        if (error) console.log(`❌ [${nombre}] Error mensajes:`, error.message);
      } else {
        console.log(`✅ [${nombre}] Mensajes ya registrados para ${hoy}`);
      }
    }
  }

  // ===========================================
  // BLOQUE 2: Páginas clasificacion=2, red_social=2 (servicios)
  // ===========================================
  const { data: pagesServices, error: pagesServicesError } = await supabase
    .from("community_paginas").select("*").eq("clasificacion", 2).eq("red_social", 2);

  if (pagesServicesError || !pagesServices?.length) {
    console.log("❌ Error cargando páginas servicios (clasificacion=2):", pagesServicesError);
  } else {
    console.log(`\n📄 Páginas servicios (clasificacion=2): ${pagesServices.length}\n`);

    for (const page of pagesServices) {
      const fbId   = page.id_page;
      const dbId   = page.id;
      const token  = page.token;
      const nombre = page.nombre || `Página servicios ${dbId}`;

      if (!fbId || !token) { console.warn(`⚠️ [${nombre}] Sin id_page o token`); continue; }

      try {
        await axios.get(`https://graph.facebook.com/v21.0/${fbId}`, { params: { fields: "id", access_token: token } });
      } catch (err) {
        console.log(`⚠️ [${nombre}] No accesible:`, err.response?.data?.error?.message || err.message);
        continue;
      }

      // Buscar page_service tipo=1 para esta página de servicios
      const { data: psRow } = await supabase
        .from("services_pages").select("id")
        .eq("id_pagina", dbId)
        .eq("tipo_page_services", 1)
        .order("fecha_inicio", { ascending: false })
        .limit(1).maybeSingle();

      const psId = psRow?.id || null;

      if (!psId) {
        console.log(`⚠️ [${nombre}] Sin services_pages tipo=1, saltando...`);
        continue;
      }

      console.log(`\n▶️ [${nombre}] (id=${dbId}, page_service=${psId})`);

      await descubrirYRegistrarPostsServices(psId, fbId, token, hoy);
      await sleep(300);
      await registrarInsightsPostsServices(psId, token, hoy);
      await sleep(300);
    }
  }

  // 4 logs de proceso al finalizar
  await registrarLog("Reporte FB: Descubrimiento y registro de posts share por page_service", hoy);
  await registrarLog("Reporte FB: Calculo acumulado share (impresiones, reactions, engagement) por pagina", hoy);
  await registrarLog("Reporte FB: Calculo delta diario de insights por pagina", hoy);
  await registrarLog("Reporte FB: Descubrimiento e insights de posts de servicio por page_service", hoy);

  console.log("\n🎉 Reporte diario Facebook completado.");
}

main();
