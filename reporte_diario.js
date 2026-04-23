const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 🔹 INSIGHTS (Meta agregados)
async function getMetric(pageId, token, metric, since, until) {
  try {
    const url = `https://graph.facebook.com/v19.0/${pageId}/insights`;

    const res = await axios.get(url, {
      params: {
        metric,
        period: "day",
        since,
        until,
        access_token: token,
      },
    });

    const values = res.data.data?.[0]?.values || [];

    return values.reduce((sum, d) => sum + (d.value || 0), 0);
  } catch (err) {
    console.error("INSIGHT ERROR:", metric, err.response?.data || err.message);
    return 0;
  }
}

// 🔥 MAIN
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
      // 📊 INSIGHTS
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

      const engagement = await getMetric(
        pageId,
        token,
        "page_post_engagements",
        since,
        until
      );

      // 🚫 SHARE simplificado (evita errores de /posts)
      const shares = await getMetric(
        pageId,
        token,
        "page_posts_impressions"
        ,
        since,
        until
      );

      console.log(`Page ${pageId}`, {
        impressions,
        reactions,
        engagement,
        shares,
      });

      // 💾 UPDATE SUPABASE
      const { error: updateError } = await supabase
        .from("pages_clientes")
        .update({
          Impresiones: impressions,
          reactions: reactions,
          engagement: engagement,
          shares: shares,
        })
        .eq("id", row.id);

      if (updateError) {
        console.error("UPDATE ERROR:", updateError);
      }

    } catch (err) {
      console.error(
        `Error page ${pageId}:`,
        err.response?.data || err.message
      );
    }
  }
}

main();
