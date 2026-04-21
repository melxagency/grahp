const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 🔹 función genérica
async function getMetric(pageId, token, metric, since, until) {
  const url = `https://graph.facebook.com/v19.0/${pageId}/insights`;

  const res = await axios.get(url, {
    params: {
      metric,
      period: "day",
      since,
      until,
      access_token: token
    }
  });

  const values = res.data.data?.[0]?.values || [];

  return values.reduce((sum, d) => sum + (d.value || 0), 0);
}

async function main() {
  const { data, error } = await supabase
    .from("pages_clientes")
    .select("*");

  if (error) {
    console.error("Supabase error:", error);
    return;
  }

  for (const row of data) {
    const pageId = row.id_page;
    const token = row.token_page;
    const since = row.fecha_inicio;
    const until = row.fecha_termino;

    try {
      // 📊 métricas Facebook
      const impressions = await getMetric(
        pageId,
        token,
        "page_impressions_unique",
        since,
        until
      );

      const reactions = await getMetric(
        pageId,
        token,
        "page_actions_post_reactions_like_total",
        since,
        until
      );

      const shares = await getMetric(
        pageId,
        token,
        "page_actions_post_shares_total",
        since,
        until
      );

      const engagement = await getMetric(
        pageId,
        token,
        "page_post_engagements",
        since,
        until
      );

      console.log(`Page ${pageId}`, {
        impressions,
        reactions,
        shares,
        engagement
      });

      // 💾 UPDATE SUPABASE (IMPORTANTE: nombres EXACTOS)
      const { error: updateError } = await supabase
        .from("pages_clientes")
        .update({
          Impresiones: impressions,
          reactions: reactions,
          shares: shares,
          engagement: engagement,
          comments: engagement
        })
        .eq("id", row.id);

      if (updateError) {
        console.error("UPDATE ERROR:", updateError);
      }

    } catch (err) {
      console.error(`Error page ${pageId}:`, err.response?.data || err.message);
    }
  }
}

main();
